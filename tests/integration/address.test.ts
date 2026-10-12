import supertest from "supertest";
import { app } from "../../src/app/web";
import { prismaClient, redis } from "../../src/app/database";
import { cacheKey } from "../../src/utils/cache.util";
import { login, Session } from "../helpers/auth";
import { resetState } from "../helpers/db";
import { createAddress, createContact, createUser, TestUser } from "../helpers/factories";
import { contacts } from "@prisma/client";

const api = () => supertest(app);
const validationError = expect.stringMatching(/^Validation Error: /);

let user: TestUser;
let session: Session;
let contact: contacts;

beforeEach(async () => {
  await resetState();
  user = await createUser();
  session = await login(user);
  contact = await createContact(user.username);
});

const auth = (req: supertest.Test) => req.set("Authorization", session.token);
const base = () => `/api/contacts/${contact.id}/addresses`;

describe("POST /api/contacts/:contactId/addresses", () => {
  const payload = {
    street: "Jl. Merdeka 1",
    city: "Bekasi",
    province: "Jawa Barat",
    country: "Indonesia",
    postalCode: "17111",
  };

  it("creates an address for the contact", async () => {
    const res = await auth(api().post(base())).send(payload);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: expect.any(Number), ...payload });
    const row = await prismaClient.addresses.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.contactId).toBe(contact.id);
  });

  it("only requires country and postal code", async () => {
    const res = await auth(api().post(base())).send({ country: "Indonesia", postalCode: "17111" });

    expect(res.status).toBe(200);
    expect(res.body.data.street).toBeUndefined();
  });

  it("takes the contact from the URL, not from the body", async () => {
    const other = await createContact(user.username, { firstName: "Other" });

    const res = await auth(api().post(base())).send({ ...payload, contactId: other.id });

    const row = await prismaClient.addresses.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.contactId).toBe(contact.id);
  });

  it.each([
    ["missing country", { country: undefined }],
    ["missing postalCode", { postalCode: undefined }],
    ["too short postalCode", { postalCode: "12" }],
    ["too short street", { street: "ab" }],
  ])("rejects %s", async (_label, patch) => {
    const res = await auth(api().post(base())).send({ ...payload, ...patch });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(validationError);
    expect(await prismaClient.addresses.count()).toBe(0);
  });

  it("answers 404 when the contact does not exist", async () => {
    const res = await auth(api().post("/api/contacts/999999/addresses")).send(payload);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ errors: "Contact not found" });
  });

  it("makes the new address show up in a list that was already cached", async () => {
    await createAddress(contact.id);
    const before = await auth(api().get(base()));
    expect(before.body.data).toHaveLength(1);

    await auth(api().post(base())).send(payload);

    const after = await auth(api().get(base()));
    expect(after.body.data).toHaveLength(2);
  });
});

describe("GET /api/contacts/:contactId/addresses/:addressId", () => {
  it("returns the address", async () => {
    const address = await createAddress(contact.id);

    const res = await auth(api().get(`${base()}/${address.id}`));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      id: address.id,
      street: "Jl. Merdeka 1",
      city: "Bekasi",
      province: "Jawa Barat",
      country: "Indonesia",
      postalCode: "17111",
    });
  });

  it("answers 404 for an unknown address", async () => {
    const address = await createAddress(contact.id);
    const res = await auth(api().get(`${base()}/${address.id + 123}`));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ errors: "Address not found" });
  });

  it("answers 404 when the address belongs to a different contact", async () => {
    const other = await createContact(user.username, { firstName: "Other" });
    const address = await createAddress(other.id);

    const res = await auth(api().get(`${base()}/${address.id}`));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ errors: "Address not found" });
  });

  it("answers 404 when the contact does not exist", async () => {
    const res = await auth(api().get("/api/contacts/999999/addresses/1"));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ errors: "Contact not found" });
  });

  it.each(["abc", "0", "1.5"])("rejects the invalid address id %p", async (id) => {
    const res = await auth(api().get(`${base()}/${id}`));
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(validationError);
  });

  it("is cached after the first read", async () => {
    const address = await createAddress(contact.id);
    const key = cacheKey.address(user.username, contact.id, address.id);

    await auth(api().get(`${base()}/${address.id}`));

    expect(await redis.get(key)).not.toBeNull();
  });
});

describe("PATCH /api/contacts/:contactId/addresses/:addressId", () => {
  it("updates only the fields that were sent", async () => {
    const address = await createAddress(contact.id);

    const res = await auth(api().patch(`${base()}/${address.id}`)).send({ city: "Jakarta", postalCode: "10110" });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ city: "Jakarta", postalCode: "10110", street: "Jl. Merdeka 1", country: "Indonesia" });
  });

  it("invalidates both the single-address and the list cache", async () => {
    const address = await createAddress(contact.id);
    await auth(api().get(`${base()}/${address.id}`));
    await auth(api().get(base()));

    await auth(api().patch(`${base()}/${address.id}`)).send({ city: "Jakarta" });

    expect(await redis.get(cacheKey.address(user.username, contact.id, address.id))).toBeNull();
    expect(await redis.get(cacheKey.addressList(user.username, contact.id))).toBeNull();
    const res = await auth(api().get(`${base()}/${address.id}`));
    expect(res.body.data.city).toBe("Jakarta");
  });

  it("rejects invalid values and leaves the address unchanged", async () => {
    const address = await createAddress(contact.id);

    const res = await auth(api().patch(`${base()}/${address.id}`)).send({ postalCode: "1" });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(validationError);
    const row = await prismaClient.addresses.findUniqueOrThrow({ where: { id: address.id } });
    expect(row.postalCode).toBe("17111");
  });

  it("answers 404 for an unknown contact or address", async () => {
    const address = await createAddress(contact.id);

    const unknownContact = await auth(api().patch(`/api/contacts/2222/addresses/${address.id}`)).send({ city: "Jakarta" });
    expect(unknownContact.status).toBe(404);

    const unknownAddress = await auth(api().patch(`${base()}/${address.id + 123}`)).send({ city: "Jakarta" });
    expect(unknownAddress.status).toBe(404);
    expect(unknownAddress.body).toEqual({ errors: "Address not found" });
  });

  it("cannot move an address to another contact", async () => {
    const other = await createContact(user.username, { firstName: "Other" });
    const address = await createAddress(contact.id);

    await auth(api().patch(`${base()}/${address.id}`)).send({ city: "Jakarta", contactId: other.id });

    const row = await prismaClient.addresses.findUniqueOrThrow({ where: { id: address.id } });
    expect(row.contactId).toBe(contact.id);
  });
});

describe("DELETE /api/contacts/:contactId/addresses/:addressId", () => {
  it("deletes only that address", async () => {
    const keep = await createAddress(contact.id, { city: "Keep" });
    const drop = await createAddress(contact.id, { city: "Drop" });

    const res = await auth(api().delete(`${base()}/${drop.id}`));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: "Address deleted successfully" });
    const remaining = await prismaClient.addresses.findMany();
    expect(remaining.map((a) => a.id)).toEqual([keep.id]);
  });

  it("removes the address from the caches", async () => {
    const address = await createAddress(contact.id);
    await auth(api().get(`${base()}/${address.id}`));
    await auth(api().get(base()));

    await auth(api().delete(`${base()}/${address.id}`));

    const single = await auth(api().get(`${base()}/${address.id}`));
    expect(single.status).toBe(404);
    const list = await auth(api().get(base()));
    expect(list.body.data).toEqual([]);
  });

  it("answers 404 for an unknown address", async () => {
    const res = await auth(api().delete(`${base()}/999999`));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ errors: "Address not found" });
  });

  it("rejects ids that are not numbers", async () => {
    const res = await auth(api().delete(`/api/contacts/abc/addresses/xyz`));
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(validationError);
  });
});

describe("GET /api/contacts/:contactId/addresses", () => {
  it("lists every address of the contact", async () => {
    for (let i = 0; i < 10; i++) await createAddress(contact.id, { city: `City${i}` });
    const other = await createContact(user.username, { firstName: "Other" });
    await createAddress(other.id, { city: "Elsewhere" });

    const res = await auth(api().get(base()));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(10);
    expect(res.body.data.map((a: { city: string }) => a.city)).not.toContain("Elsewhere");
  });

  it("returns an empty list for a contact without addresses", async () => {
    const res = await auth(api().get(base()));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("answers 404 when the contact does not exist", async () => {
    const res = await auth(api().get("/api/contacts/999999/addresses"));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ errors: "Contact not found" });
  });

  it("rejects a contact id that is not a number", async () => {
    const res = await auth(api().get("/api/contacts/abc/addresses"));
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(validationError);
  });
});
