import supertest from "supertest";
import { app } from "../../src/app/web";
import { prismaClient } from "../../src/app/database";
import { login } from "../helpers/auth";
import { resetState } from "../helpers/db";
import { createAddress, createContact, createUser } from "../helpers/factories";

const api = () => supertest(app);

beforeEach(resetState);

/** Two users, each with one contact and one address. */
async function twoUsers() {
  const alice = await createUser({ username: "alice123", name: "Alice" });
  const bob = await createUser({ username: "bob12345", name: "Bob" });
  const aliceContact = await createContact(alice.username, { firstName: "AliceContact" });
  const bobContact = await createContact(bob.username, { firstName: "BobContact" });
  const aliceAddress = await createAddress(aliceContact.id, { city: "AliceCity" });
  const bobAddress = await createAddress(bobContact.id, { city: "BobCity" });
  const aliceSession = await login(alice);
  const bobSession = await login(bob);
  return { alice, bob, aliceContact, bobContact, aliceAddress, bobAddress, aliceSession, bobSession };
}

describe("users cannot see or touch each other's data", () => {
  it("cannot read another user's contact or address", async () => {
    const { aliceContact, aliceAddress, bobSession } = await twoUsers();
    const bob = (req: supertest.Test) => req.set("Authorization", bobSession.token);

    const contact = await bob(api().get(`/api/contacts/${aliceContact.id}`));
    expect(contact.status).toBe(404);
    expect(contact.body).toEqual({ errors: "Contact not found" });

    const address = await bob(api().get(`/api/contacts/${aliceContact.id}/addresses/${aliceAddress.id}`));
    expect(address.status).toBe(404);

    const list = await bob(api().get(`/api/contacts/${aliceContact.id}/addresses`));
    expect(list.status).toBe(404);
  });

  it("cannot modify or delete another user's contact", async () => {
    const { aliceContact, bobSession } = await twoUsers();
    const bob = (req: supertest.Test) => req.set("Authorization", bobSession.token);

    const patch = await bob(api().patch(`/api/contacts/${aliceContact.id}`)).send({ firstName: "Hacked" });
    expect(patch.status).toBe(404);

    const del = await bob(api().delete(`/api/contacts/${aliceContact.id}`));
    expect(del.status).toBe(404);

    const row = await prismaClient.contacts.findUniqueOrThrow({ where: { id: aliceContact.id } });
    expect(row.firstName).toBe("AliceContact");
  });

  it("cannot add, change or remove addresses on another user's contact", async () => {
    const { aliceContact, aliceAddress, bobSession } = await twoUsers();
    const bob = (req: supertest.Test) => req.set("Authorization", bobSession.token);
    const base = `/api/contacts/${aliceContact.id}/addresses`;

    const create = await bob(api().post(base)).send({ country: "Indonesia", postalCode: "17111" });
    expect(create.status).toBe(404);

    const patch = await bob(api().patch(`${base}/${aliceAddress.id}`)).send({ city: "Hacked" });
    expect(patch.status).toBe(404);

    const del = await bob(api().delete(`${base}/${aliceAddress.id}`));
    expect(del.status).toBe(404);

    expect(await prismaClient.addresses.count({ where: { contactId: aliceContact.id } })).toBe(1);
    const row = await prismaClient.addresses.findUniqueOrThrow({ where: { id: aliceAddress.id } });
    expect(row.city).toBe("AliceCity");
  });

  it("only searches within the caller's own contacts", async () => {
    const { bobSession } = await twoUsers();

    const res = await api().get("/api/contacts").query({ page: 1, size: 10 }).set("Authorization", bobSession.token);

    expect(res.body.data.map((c: { firstName: string }) => c.firstName)).toEqual(["BobContact"]);
  });
});

describe("cache isolation", () => {
  // Regression test. The cache used to be keyed by `username + id`, so the
  // contact 2 of "testuser1" and contact 12 of "testuser" both mapped to
  // "testuser12" and one user was served the other's cached contact.
  it("never serves one user's cached contact to another user, even with ambiguous key parts", async () => {
    const a = await createUser({ username: "testuser1", name: "A" });
    const b = await createUser({ username: "testuser", name: "B" });
    await prismaClient.contacts.create({
      data: { id: 2, firstName: "Alpha", lastName: "OfA", username: a.username },
    });
    await prismaClient.contacts.create({
      data: { id: 12, firstName: "Bravo", lastName: "OfB", username: b.username },
    });
    const sessionA = await login(a);
    const sessionB = await login(b);

    const first = await api().get("/api/contacts/2").set("Authorization", sessionA.token);
    expect(first.body.data.firstName).toBe("Alpha");

    const second = await api().get("/api/contacts/12").set("Authorization", sessionB.token);
    expect(second.status).toBe(200);
    expect(second.body.data.firstName).toBe("Bravo");
  });

  it("does the same for addresses", async () => {
    const a = await createUser({ username: "testuser1", name: "A" });
    const b = await createUser({ username: "testuser", name: "B" });
    const contactA = await prismaClient.contacts.create({ data: { id: 2, firstName: "Alpha", username: a.username } });
    const contactB = await prismaClient.contacts.create({ data: { id: 12, firstName: "Bravo", username: b.username } });
    const addressA = await createAddress(contactA.id, { city: "CityOfA" });
    const addressB = await createAddress(contactB.id, { city: "CityOfB" });
    const sessionA = await login(a);
    const sessionB = await login(b);

    const first = await api().get(`/api/contacts/${contactA.id}/addresses/${addressA.id}`).set("Authorization", sessionA.token);
    expect(first.body.data.city).toBe("CityOfA");

    const second = await api().get(`/api/contacts/${contactB.id}/addresses/${addressB.id}`).set("Authorization", sessionB.token);
    expect(second.body.data.city).toBe("CityOfB");
  });

  it("keeps the profile cache per user", async () => {
    const { aliceSession, bobSession } = await twoUsers();

    const alice = await api().get("/api/users/current").set("Authorization", aliceSession.token);
    const bob = await api().get("/api/users/current").set("Authorization", bobSession.token);

    expect(alice.body.data.name).toBe("Alice");
    expect(bob.body.data.name).toBe("Bob");
  });
});
