import supertest from "supertest";
import { app } from "../../src/app/web";
import { prismaClient, redis } from "../../src/app/database";
import { cacheKey } from "../../src/utils/cache.util";
import { login, Session } from "../helpers/auth";
import { resetState } from "../helpers/db";
import { createAddress, createContact, createUser, TestUser } from "../helpers/factories";

const api = () => supertest(app);
const validationError = expect.stringMatching(/^Validation Error: /);

let user: TestUser;
let session: Session;

beforeEach(async () => {
  await resetState();
  user = await createUser();
  session = await login(user);
});

const auth = (req: supertest.Test) => req.set("Authorization", session.token);

describe("POST /api/contacts", () => {
  const payload = { firstName: "John", lastName: "Smith", email: "john@example.com", phone: "081234567890" };

  it("creates a contact owned by the caller", async () => {
    const res = await auth(api().post("/api/contacts")).send(payload);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: expect.any(Number), ...payload });
    const row = await prismaClient.contacts.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.username).toBe(user.username);
  });

  it("works without an email", async () => {
    const { email, ...withoutEmail } = payload;
    const res = await auth(api().post("/api/contacts")).send(withoutEmail);

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBeUndefined();
  });

  it("cannot create a contact on behalf of another user", async () => {
    const other = await createUser({ username: "other1234" });

    const res = await auth(api().post("/api/contacts")).send({ ...payload, username: other.username });

    expect(res.status).toBe(200);
    const row = await prismaClient.contacts.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.username).toBe(user.username);
  });

  it.each([
    ["missing lastName", { lastName: undefined }],
    ["invalid email", { email: "not-an-email" }],
    ["too short phone", { phone: "0896" }],
    ["too short firstName", { firstName: "Jo" }],
  ])("rejects %s", async (_label, patch) => {
    const res = await auth(api().post("/api/contacts")).send({ ...payload, ...patch });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(validationError);
    expect(await prismaClient.contacts.count()).toBe(0);
  });

  it("requires authentication", async () => {
    const res = await api().post("/api/contacts").send(payload);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ errors: "Unauthorized" });
  });
});

describe("GET /api/contacts/:contactId", () => {
  it("returns the contact", async () => {
    const contact = await createContact(user.username);

    const res = await auth(api().get(`/api/contacts/${contact.id}`));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      id: contact.id,
      firstName: "Jane",
      lastName: "Doe",
      email: "jane.doe@example.com",
      phone: "081234567890",
    });
  });

  it("answers 404 for a contact that does not exist", async () => {
    const res = await auth(api().get("/api/contacts/999999"));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ errors: "Contact not found" });
  });

  it.each(["abc", "0", "-1", "1.5", "99999999999"])("rejects the invalid id %p with a validation error", async (id) => {
    const res = await auth(api().get(`/api/contacts/${id}`));
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(validationError);
  });

  it("is cached after the first read and the cache is dropped by an update", async () => {
    const contact = await createContact(user.username);
    const key = cacheKey.contact(user.username, contact.id);
    expect(await redis.get(key)).toBeNull();

    await auth(api().get(`/api/contacts/${contact.id}`));
    expect(await redis.get(key)).not.toBeNull();

    await auth(api().patch(`/api/contacts/${contact.id}`)).send({ firstName: "Janet" });
    expect(await redis.get(key)).toBeNull();

    const res = await auth(api().get(`/api/contacts/${contact.id}`));
    expect(res.body.data.firstName).toBe("Janet");
  });

  it("requires authentication", async () => {
    const contact = await createContact(user.username);
    const res = await api().get(`/api/contacts/${contact.id}`);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ errors: "Unauthorized" });
  });
});

describe("PATCH /api/contacts/:contactId", () => {
  it("updates only the fields that were sent", async () => {
    const contact = await createContact(user.username);

    const res = await auth(api().patch(`/api/contacts/${contact.id}`)).send({ firstName: "Janet", lastName: "Smith" });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ firstName: "Janet", lastName: "Smith", email: "jane.doe@example.com" });
    const row = await prismaClient.contacts.findUniqueOrThrow({ where: { id: contact.id } });
    expect(row).toMatchObject({ firstName: "Janet", lastName: "Smith", phone: "081234567890" });
  });

  it("rejects invalid values and leaves the contact unchanged", async () => {
    const contact = await createContact(user.username);

    const res = await auth(api().patch(`/api/contacts/${contact.id}`)).send({ firstName: "B", lastName: "a" });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(validationError);
    const row = await prismaClient.contacts.findUniqueOrThrow({ where: { id: contact.id } });
    expect(row.firstName).toBe("Jane");
  });

  it("cannot move the contact to another owner", async () => {
    const contact = await createContact(user.username);
    await createUser({ username: "other1234" });

    await auth(api().patch(`/api/contacts/${contact.id}`)).send({ firstName: "Janet", username: "other1234" });

    const row = await prismaClient.contacts.findUniqueOrThrow({ where: { id: contact.id } });
    expect(row.username).toBe(user.username);
  });

  it("answers 404 for a contact that does not exist", async () => {
    const res = await auth(api().patch("/api/contacts/999999")).send({ firstName: "Janet" });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ errors: "Contact not found" });
  });
});

describe("DELETE /api/contacts/:contactId", () => {
  it("deletes the contact together with its addresses", async () => {
    const contact = await createContact(user.username);
    await createAddress(contact.id);
    await createAddress(contact.id);

    const res = await auth(api().delete(`/api/contacts/${contact.id}`));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: "Contact deleted successfully" });
    expect(await prismaClient.contacts.count()).toBe(0);
    expect(await prismaClient.addresses.count()).toBe(0);
  });

  it("only removes the targeted contact", async () => {
    const keep = await createContact(user.username, { firstName: "Keep" });
    const drop = await createContact(user.username, { firstName: "Drop" });

    await auth(api().delete(`/api/contacts/${drop.id}`));

    const remaining = await prismaClient.contacts.findMany();
    expect(remaining.map((c) => c.id)).toEqual([keep.id]);
  });

  it("drops the cached copy so a deleted contact is really gone", async () => {
    const contact = await createContact(user.username);
    await auth(api().get(`/api/contacts/${contact.id}`)); // primes the cache

    await auth(api().delete(`/api/contacts/${contact.id}`));

    const res = await auth(api().get(`/api/contacts/${contact.id}`));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ errors: "Contact not found" });
  });

  it.each(["999999", "2000000000"])("answers 404 for the unknown id %s", async (id) => {
    const res = await auth(api().delete(`/api/contacts/${id}`));
    expect(res.status).toBe(404);
  });
});

describe("GET /api/contacts (search)", () => {
  const seed = async (count: number) => {
    for (let i = 1; i <= count; i++) {
      await createContact(user.username, {
        firstName: `Contact${String(i).padStart(2, "0")}`,
        lastName: "Tester",
        email: `contact${i}@example.com`,
        phone: `0812000000${String(i).padStart(2, "0")}`,
      });
    }
  };

  const search = (query: Record<string, string | number>) => auth(api().get("/api/contacts")).query(query);

  it("returns the first page of 10 by default", async () => {
    await seed(25);

    const res = await auth(api().get("/api/contacts"));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(10);
    expect(res.body.paging).toEqual({ currentPage: 1, totalPage: 3, size: 10 });
  });

  it("pages through every contact exactly once, in a stable order", async () => {
    await seed(25);

    const ids: number[] = [];
    for (const page of [1, 2, 3]) {
      const res = await search({ page, size: 10 });
      ids.push(...res.body.data.map((c: { id: number }) => c.id));
    }

    expect(ids).toHaveLength(25);
    expect(new Set(ids).size).toBe(25);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it("returns a partial last page and an empty page beyond the end", async () => {
    await seed(25);

    const last = await search({ page: 3, size: 10 });
    expect(last.body.data).toHaveLength(5);

    const beyond = await search({ page: 4, size: 10 });
    expect(beyond.body.data).toEqual([]);
    expect(beyond.body.paging).toEqual({ currentPage: 4, totalPage: 3, size: 10 });
  });

  it("filters by name across first and last name", async () => {
    await createContact(user.username, { firstName: "Alice", lastName: "Wonderland" });
    await createContact(user.username, { firstName: "Bob", lastName: "Alicesson" });
    await createContact(user.username, { firstName: "Carol", lastName: "Danvers" });

    const res = await search({ name: "alice", page: 1, size: 10 });

    expect(res.body.data.map((c: { firstName: string }) => c.firstName).sort()).toEqual(["Alice", "Bob"]);
  });

  it("filters by email and by phone", async () => {
    await seed(5);

    const byEmail = await search({ email: "contact3@example.com", page: 1, size: 10 });
    expect(byEmail.body.data).toHaveLength(1);
    expect(byEmail.body.data[0].firstName).toBe("Contact03");

    const byPhone = await search({ phone: "081200000004", page: 1, size: 10 });
    expect(byPhone.body.data).toHaveLength(1);
    expect(byPhone.body.data[0].firstName).toBe("Contact04");
  });

  it("combines filters with AND", async () => {
    await createContact(user.username, { firstName: "Alice", lastName: "Wonderland", email: "a@example.com" });
    await createContact(user.username, { firstName: "Alice", lastName: "Other", email: "b@example.com" });

    const res = await search({ name: "alice", email: "b@example.com", page: 1, size: 10 });

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].lastName).toBe("Other");
  });

  it("returns an empty result with zero pages when nothing matches", async () => {
    await seed(3);

    const res = await search({ name: "does-not-exist", page: 1, size: 10 });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.paging.totalPage).toBe(0);
  });

  it.each([
    ["page=0", { page: 0, size: 10 }],
    ["page=abc", { page: "abc", size: 10 }],
    ["size=0", { page: 1, size: 0 }],
    ["size=101", { page: 1, size: 101 }],
    ["an invalid email filter", { page: 1, size: 10, email: "nope" }],
  ])("rejects %s", async (_label, query) => {
    const res = await search(query);
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(validationError);
  });

  it("requires authentication", async () => {
    const res = await api().get("/api/contacts").set("Authorization", "123456");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ errors: "Invalid token" });
  });
});
