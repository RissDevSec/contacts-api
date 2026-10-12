import { z } from "zod";
import { ContactService } from "../../src/services/contact.service";
import type { MockDatabase } from "../helpers/mockDatabase";

jest.mock("../../src/app/database", () =>
  require("../helpers/mockDatabase").createMockDatabase()
);

import { prismaClient, redis } from "../../src/app/database";
const db = prismaClient as unknown as MockDatabase["prismaClient"];
const cache = redis as unknown as MockDatabase["redis"];

const user = { username: "alice123", newAccessToken: "fresh" };
const row = { id: 5, firstName: "Jane", lastName: "Doe", email: "j@d.co", phone: "081234567890", username: "alice123" };

describe("ContactService.create", () => {
  const request = { firstName: "Jane", lastName: "Doee", email: "j@d.co", phone: "081234567890" };

  it("always assigns the contact to the authenticated user", async () => {
    db.contacts.create.mockImplementation(async ({ data }) => ({ id: 1, ...data }));

    // a client trying to create a contact for somebody else
    await ContactService.create(user, { ...request, username: "mallory1", id: 99 } as typeof request);

    expect(db.contacts.create).toHaveBeenCalledWith({ data: { ...request, username: "alice123" } });
  });

  it("returns the response with the refreshed token", async () => {
    db.contacts.create.mockResolvedValue(row);
    const res = await ContactService.create(user, request);
    expect(res.data.id).toBe(5);
    expect(res.newAccessToken).toBe("fresh");
  });

  it("rejects invalid input", async () => {
    await expect(ContactService.create(user, { firstName: "J" } as typeof request)).rejects.toBeInstanceOf(z.ZodError);
    expect(db.contacts.create).not.toHaveBeenCalled();
  });
});

describe("ContactService.get", () => {
  it("serves from the cache when present", async () => {
    cache.get.mockResolvedValue(JSON.stringify(row));

    const res = await ContactService.get(user, 5);

    expect(res.data.firstName).toBe("Jane");
    expect(cache.get).toHaveBeenCalledWith("contact:alice123:5");
    expect(db.contacts.findUnique).not.toHaveBeenCalled();
  });

  it("looks the contact up for the owner only and caches it on a miss", async () => {
    cache.get.mockResolvedValue(null);
    db.contacts.findUnique.mockResolvedValue(row);

    await ContactService.get(user, 5);

    expect(db.contacts.findUnique).toHaveBeenCalledWith({ where: { id: 5, username: "alice123" } });
    expect(cache.setex).toHaveBeenCalledWith("contact:alice123:5", 3600, JSON.stringify(row));
  });

  it("answers 404 when it is not found and does not cache the miss", async () => {
    cache.get.mockResolvedValue(null);
    db.contacts.findUnique.mockResolvedValue(null);

    await expect(ContactService.get(user, 5)).rejects.toMatchObject({ message: "Contact not found", status: 404 });
    expect(cache.setex).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, NaN])("rejects the invalid id %p", async (id) => {
    await expect(ContactService.get(user, id)).rejects.toBeInstanceOf(z.ZodError);
    expect(cache.get).not.toHaveBeenCalled();
  });
});

describe("ContactService.update", () => {
  it("checks ownership, updates, and invalidates the cache", async () => {
    db.contacts.findUnique.mockResolvedValue(row);
    db.contacts.update.mockResolvedValue({ ...row, firstName: "Janet" });

    const res = await ContactService.update(user, { id: 5, firstName: "Janet" });

    expect(db.contacts.findUnique).toHaveBeenCalledWith({ where: { id: 5, username: "alice123" } });
    expect(db.contacts.update).toHaveBeenCalledWith({
      where: { id: 5, username: "alice123" },
      data: { id: 5, firstName: "Janet" },
    });
    expect(cache.del).toHaveBeenCalledWith("contact:alice123:5");
    expect(res.data.firstName).toBe("Janet");
  });

  it("does not update a contact that is not the caller's", async () => {
    db.contacts.findUnique.mockResolvedValue(null);
    await expect(ContactService.update(user, { id: 5, firstName: "Janet" })).rejects.toMatchObject({ status: 404 });
    expect(db.contacts.update).not.toHaveBeenCalled();
    expect(cache.del).not.toHaveBeenCalled();
  });
});

describe("ContactService.remove", () => {
  it("deletes the addresses first, then the contact, then the cache entry", async () => {
    db.contacts.findUnique.mockResolvedValue(row);
    const order: string[] = [];
    db.addresses.deleteMany.mockImplementation(async () => order.push("addresses"));
    db.contacts.delete.mockImplementation(async () => order.push("contact"));
    cache.del.mockImplementation(async () => order.push("cache"));

    await ContactService.remove(user, 5);

    expect(order).toEqual(["addresses", "contact", "cache"]);
    expect(db.addresses.deleteMany).toHaveBeenCalledWith({ where: { contactId: 5 } });
    expect(db.contacts.delete).toHaveBeenCalledWith({ where: { username: "alice123", id: 5 } });
    expect(cache.del).toHaveBeenCalledWith("contact:alice123:5");
  });

  it("deletes nothing when the contact is not the caller's", async () => {
    db.contacts.findUnique.mockResolvedValue(null);
    await expect(ContactService.remove(user, 5)).rejects.toMatchObject({ status: 404 });
    expect(db.addresses.deleteMany).not.toHaveBeenCalled();
    expect(db.contacts.delete).not.toHaveBeenCalled();
  });
});

describe("ContactService.search", () => {
  beforeEach(() => {
    db.contacts.findMany.mockResolvedValue([{ id: 1, firstName: "Jane" }]);
    db.contacts.count.mockResolvedValue(25);
  });

  it("is always scoped to the caller and ordered by id", async () => {
    await ContactService.search(user, { page: 1, size: 10 });

    expect(db.contacts.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { username: "alice123" },
        orderBy: { id: "asc" },
        take: 10,
        skip: 0,
      })
    );
  });

  it("computes skip, take and the paging block from page and size", async () => {
    const res = await ContactService.search(user, { page: 3, size: 10 });

    expect(db.contacts.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10, skip: 20 }));
    expect(res.paging).toEqual({ currentPage: 3, totalPage: 3, size: 10 });
    expect(res.newAccessToken).toBe("fresh");
  });

  it("matches name against first and last name", async () => {
    await ContactService.search(user, { page: 1, size: 10, name: "ja" });

    expect(db.contacts.findMany.mock.calls[0][0].where.AND).toEqual([
      { OR: [{ firstName: { contains: "ja" } }, { lastName: { contains: "ja" } }] },
    ]);
  });

  it("combines every filter with AND", async () => {
    await ContactService.search(user, { page: 1, size: 10, name: "ja", email: "j@d.co", phone: "0812" });

    expect(db.contacts.findMany.mock.calls[0][0].where.AND).toEqual([
      { OR: [{ firstName: { contains: "ja" } }, { lastName: { contains: "ja" } }] },
      { email: { contains: "j@d.co" } },
      { phone: { contains: "0812" } },
    ]);
    expect(db.contacts.count).toHaveBeenCalledWith({
      where: { username: "alice123", AND: expect.any(Array) },
    });
  });

  it("reports zero pages when nothing matches", async () => {
    db.contacts.findMany.mockResolvedValue([]);
    db.contacts.count.mockResolvedValue(0);
    const res = await ContactService.search(user, { page: 1, size: 10 });
    expect(res.data).toEqual([]);
    expect(res.paging.totalPage).toBe(0);
  });

  it.each([
    ["page 0", { page: 0, size: 10 }],
    ["size 101", { page: 1, size: 101 }],
  ])("rejects %s", async (_label, req) => {
    await expect(ContactService.search(user, req)).rejects.toBeInstanceOf(z.ZodError);
    expect(db.contacts.findMany).not.toHaveBeenCalled();
  });
});