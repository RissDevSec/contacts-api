import { z } from "zod";
import { AddressService } from "../../src/services/address.service";
import type { MockDatabase } from "../helpers/mockDatabase";

jest.mock("../../src/app/database", () =>
  require("../helpers/mockDatabase").createMockDatabase()
);

import { prismaClient, redis } from "../../src/app/database";
const db = prismaClient as unknown as MockDatabase["prismaClient"];
const cache = redis as unknown as MockDatabase["redis"];

const user = { username: "alice123", newAccessToken: "fresh" };
const contact = { id: 3, username: "alice123" };
const address = { id: 7, street: "Jl. Merdeka 1", city: "Bekasi", province: null, country: "Indonesia", postalCode: "17111", contactId: 3 };

const ownsContact = () => db.contacts.findUnique.mockResolvedValue(contact);
const contactMissing = () => db.contacts.findUnique.mockResolvedValue(null);

describe("AddressService.create", () => {
  const request = { country: "Indonesia", postalCode: "17111", contactId: 3 };

  it("creates the address for a contact the caller owns and drops the list cache", async () => {
    ownsContact();
    db.addresses.create.mockResolvedValue(address);

    const res = await AddressService.create(user, request);

    expect(db.contacts.findUnique).toHaveBeenCalledWith({ where: { id: 3, username: "alice123" } });
    expect(db.addresses.create).toHaveBeenCalledWith({ data: request });
    expect(cache.del).toHaveBeenCalledWith("address-list:alice123:3");
    expect(res.data.id).toBe(7);
  });

  it("does not create anything for somebody else's contact", async () => {
    contactMissing();
    await expect(AddressService.create(user, request)).rejects.toMatchObject({ message: "Contact not found", status: 404 });
    expect(db.addresses.create).not.toHaveBeenCalled();
  });

  it("rejects invalid input", async () => {
    await expect(AddressService.create(user, { contactId: 3 } as typeof request)).rejects.toBeInstanceOf(z.ZodError);
    expect(db.contacts.findUnique).not.toHaveBeenCalled();
  });
});

describe("AddressService.get", () => {
  it("serves from the cache without hitting the database", async () => {
    cache.get.mockResolvedValue(JSON.stringify(address));

    const res = await AddressService.get(user, 3, 7);

    expect(cache.get).toHaveBeenCalledWith("address:alice123:3:7");
    expect(db.contacts.findUnique).not.toHaveBeenCalled();
    expect(res.data.city).toBe("Bekasi");
  });

  it("verifies contact and address on a miss, then caches", async () => {
    cache.get.mockResolvedValue(null);
    ownsContact();
    db.addresses.findUnique.mockResolvedValue(address);

    await AddressService.get(user, 3, 7);

    expect(db.addresses.findUnique).toHaveBeenCalledWith({ where: { id: 7, contactId: 3 } });
    expect(cache.setex).toHaveBeenCalledWith("address:alice123:3:7", 3600, JSON.stringify(address));
  });

  it("answers 404 when the address is not found", async () => {
    cache.get.mockResolvedValue(null);
    ownsContact();
    db.addresses.findUnique.mockResolvedValue(null);

    await expect(AddressService.get(user, 3, 7)).rejects.toMatchObject({ message: "Address not found", status: 404 });
    expect(cache.setex).not.toHaveBeenCalled();
  });

  it("answers 404 when the contact is not the caller's", async () => {
    cache.get.mockResolvedValue(null);
    contactMissing();
    await expect(AddressService.get(user, 3, 7)).rejects.toMatchObject({ message: "Contact not found", status: 404 });
  });
});

describe("AddressService.update", () => {
  it("updates and invalidates both the address and the list cache", async () => {
    ownsContact();
    db.addresses.findUnique.mockResolvedValue(address);
    db.addresses.update.mockResolvedValue({ ...address, city: "Jakarta" });

    const res = await AddressService.update(user, { id: 7, contactId: 3, city: "Jakarta" });

    expect(db.addresses.update).toHaveBeenCalledWith({
      where: { id: 7, contactId: 3 },
      data: { id: 7, contactId: 3, city: "Jakarta" },
    });
    expect(cache.del).toHaveBeenCalledWith("address:alice123:3:7");
    expect(cache.del).toHaveBeenCalledWith("address-list:alice123:3");
    expect(res.data.city).toBe("Jakarta");
  });

  it("does not update an address that does not belong to the contact", async () => {
    ownsContact();
    db.addresses.findUnique.mockResolvedValue(null);
    await expect(AddressService.update(user, { id: 7, contactId: 3, city: "Jakarta" })).rejects.toMatchObject({ status: 404 });
    expect(db.addresses.update).not.toHaveBeenCalled();
  });
});

describe("AddressService.remove", () => {
  it("deletes the address and invalidates both cache entries", async () => {
    ownsContact();
    db.addresses.findUnique.mockResolvedValue(address);

    await AddressService.remove(user, 3, 7);

    expect(db.addresses.delete).toHaveBeenCalledWith({ where: { id: 7, contactId: 3 } });
    expect(cache.del).toHaveBeenCalledWith("address:alice123:3:7");
    expect(cache.del).toHaveBeenCalledWith("address-list:alice123:3");
  });

  it("deletes nothing when the contact is not the caller's", async () => {
    contactMissing();
    await expect(AddressService.remove(user, 3, 7)).rejects.toMatchObject({ status: 404 });
    expect(db.addresses.delete).not.toHaveBeenCalled();
  });
});

describe("AddressService.list", () => {
  it("serves from the cache when present", async () => {
    cache.get.mockResolvedValue(JSON.stringify([address]));

    const res = await AddressService.list(user, 3);

    expect(cache.get).toHaveBeenCalledWith("address-list:alice123:3");
    expect(db.addresses.findMany).not.toHaveBeenCalled();
    expect(res.data).toHaveLength(1);
    expect(res.newAccessToken).toBe("fresh");
  });

  it("queries the contact's addresses on a miss and caches them", async () => {
    cache.get.mockResolvedValue(null);
    ownsContact();
    db.addresses.findMany.mockResolvedValue([address]);

    await AddressService.list(user, 3);

    expect(db.addresses.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { contactId: 3 } }));
    expect(cache.setex).toHaveBeenCalledWith("address-list:alice123:3", 3600, JSON.stringify([address]));
  });

  it("answers 404 when the contact is not the caller's", async () => {
    cache.get.mockResolvedValue(null);
    contactMissing();
    await expect(AddressService.list(user, 3)).rejects.toMatchObject({ message: "Contact not found", status: 404 });
    expect(db.addresses.findMany).not.toHaveBeenCalled();
  });
});