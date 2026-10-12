import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import supertest from "supertest";
import { app } from "../../src/app/web";
import { prismaClient, redis } from "../../src/app/database";
import { cacheKey } from "../../src/utils/cache.util";
import { login, signAccessToken } from "../helpers/auth";
import { resetState } from "../helpers/db";
import { createUser, DEFAULT_PASSWORD } from "../helpers/factories";

const api = () => supertest(app);

beforeEach(resetState);

const validationError = expect.stringMatching(/^Validation Error: /);

describe("POST /api/users (register)", () => {
  const payload = { username: "alice123", password: "password123", name: "Alice" };

  it("creates the user and never returns the password", async () => {
    const res = await api().post("/api/users").send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { username: "alice123", name: "Alice" } });
    expect(JSON.stringify(res.body)).not.toContain("password");
  });

  it("stores only a bcrypt hash of the password", async () => {
    await api().post("/api/users").send(payload);

    const row = await prismaClient.users.findUniqueOrThrow({ where: { username: "alice123" } });
    expect(row.password).not.toBe("password123");
    expect(await bcrypt.compare("password123", row.password)).toBe(true);
    expect(row.token).toBeNull();
  });

  it("rejects a username that is already taken", async () => {
    await createUser({ username: "alice123" });

    const res = await api().post("/api/users").send(payload);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ errors: "Username already exists" });
    expect(await prismaClient.users.count()).toBe(1);
  });

  it.each([
    ["username shorter than 8 characters", { username: "short" }],
    ["password shorter than 8 characters", { password: "short" }],
    ["missing name", { name: undefined }],
    ["empty name", { name: "" }],
    ["non-string password", { password: 12345678 }],
  ])("rejects %s", async (_label, patch) => {
    const res = await api().post("/api/users").send({ ...payload, ...patch });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(validationError);
    expect(await prismaClient.users.count()).toBe(0);
  });

  it("ignores fields that are not part of the registration contract", async () => {
    await api().post("/api/users").send({ ...payload, token: "stolen-token" });

    const row = await prismaClient.users.findUniqueOrThrow({ where: { username: "alice123" } });
    expect(row.token).toBeNull();
  });

  it("answers 400 for a malformed JSON body", async () => {
    const res = await api().post("/api/users").set("Content-Type", "application/json").send("{ not json");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ errors: "Invalid JSON body" });
  });
});

describe("POST /api/users/login", () => {
  it("returns the user and an expiring access token", async () => {
    const user = await createUser();

    const res = await api().post("/api/users/login").send({ username: user.username, password: user.password });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ username: user.username, name: user.name });
    const payload = jwt.verify(res.body.accessToken, process.env.SECRET_KEY as string) as jwt.JwtPayload;
    expect(payload.username).toBe(user.username);
    expect(payload.exp! - payload.iat!).toBe(3600);
  });

  it("hands the refresh token over as a signed httpOnly cookie, not in the body", async () => {
    const user = await createUser();

    const res = await api().post("/api/users/login").send({ username: user.username, password: user.password });

    expect(res.body.refreshToken).toBeUndefined();
    const cookie = (res.headers["set-cookie"] as unknown as string[])[0];
    expect(cookie).toMatch(/^refreshToken=s%3A/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });

  it("stores the refresh token and reuses it on the next login", async () => {
    const user = await createUser();

    const first = await login(user);
    const stored = await prismaClient.users.findUniqueOrThrow({ where: { username: user.username } });
    expect(stored.token).toBeTruthy();
    expect(jwt.verify(stored.token!, process.env.SECRET_KEY_DATABASE as string)).toMatchObject({ username: user.username });

    const second = await login(user);
    expect(second.cookie).toBe(first.cookie);
  });

  it("rejects an unknown username", async () => {
    const res = await api().post("/api/users/login").send({ username: "nobody123", password: DEFAULT_PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ errors: "Invalid credentials" });
  });

  it("rejects a wrong password and does not issue a refresh token", async () => {
    const user = await createUser();

    const res = await api().post("/api/users/login").send({ username: user.username, password: "wrongpassword" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ errors: "Invalid credentials" });
    expect(res.headers["set-cookie"]).toBeUndefined();
    const row = await prismaClient.users.findUniqueOrThrow({ where: { username: user.username } });
    expect(row.token).toBeNull();
  });

  it.each([
    ["missing password", { username: "testuser1" }],
    ["missing username", { password: "password123" }],
    ["empty body", {}],
  ])("rejects %s", async (_label, body) => {
    const res = await api().post("/api/users/login").send(body);
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(validationError);
  });
});

describe("GET /api/users/current", () => {
  it("returns the authenticated user without sensitive fields", async () => {
    const user = await createUser();
    const { token } = await login(user);

    const res = await api().get("/api/users/current").set("Authorization", token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { username: user.username, name: user.name } });
  });

  it("caches only the public fields, never the password hash or refresh token", async () => {
    const user = await createUser();
    const { token } = await login(user);

    await api().get("/api/users/current").set("Authorization", token);

    const cached = await redis.get(cacheKey.user(user.username));
    expect(JSON.parse(cached!)).toEqual({ username: user.username, name: user.name });
  });

  it("is served from the cache until something invalidates it", async () => {
    const user = await createUser();
    const { token } = await login(user);
    await api().get("/api/users/current").set("Authorization", token);

    // change the row behind the API's back
    await prismaClient.users.update({ where: { username: user.username }, data: { name: "Changed Directly" } });

    const res = await api().get("/api/users/current").set("Authorization", token);
    expect(res.body.data.name).toBe(user.name);
  });

  it("answers 404 for a valid token whose user no longer exists", async () => {
    const res = await api().get("/api/users/current").set("Authorization", signAccessToken("ghost1234"));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ errors: "User not found" });
  });

  it.each([
    ["no Authorization header", undefined, "Unauthorized"],
    ["a garbage token", "test", "Invalid token"],
    ["a token signed with another secret", signAccessToken("testuser1", "another-secret"), "Invalid token"],
  ])("rejects a request with %s", async (_label, token, message) => {
    await createUser();
    const request = api().get("/api/users/current");
    const res = await (token ? request.set("Authorization", token) : request);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ errors: message });
  });
});

describe("PATCH /api/users/current", () => {
  it("updates the name", async () => {
    const user = await createUser();
    const { token } = await login(user);

    const res = await api().patch("/api/users/current").set("Authorization", token).send({ name: "Bonzz" });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ username: user.username, name: "Bonzz" });
    const row = await prismaClient.users.findUniqueOrThrow({ where: { username: user.username } });
    expect(row.name).toBe("Bonzz");
  });

  it("changes the password: the new one works and the old one stops working", async () => {
    const user = await createUser();
    const { token } = await login(user);

    const res = await api().patch("/api/users/current").set("Authorization", token).send({ password: "brandnewpassword" });
    expect(res.status).toBe(200);

    const oldLogin = await api().post("/api/users/login").send({ username: user.username, password: user.password });
    expect(oldLogin.status).toBe(401);
    const newLogin = await api().post("/api/users/login").send({ username: user.username, password: "brandnewpassword" });
    expect(newLogin.status).toBe(200);
  });

  it("invalidates the cached profile", async () => {
    const user = await createUser();
    const { token } = await login(user);
    await api().get("/api/users/current").set("Authorization", token); // primes the cache
    expect(await redis.get(cacheKey.user(user.username))).not.toBeNull();

    await api().patch("/api/users/current").set("Authorization", token).send({ name: "Fresh Name" });

    const res = await api().get("/api/users/current").set("Authorization", token);
    expect(res.body.data.name).toBe("Fresh Name");
  });

  it("accepts an empty body and changes nothing", async () => {
    const user = await createUser();
    const { token } = await login(user);

    const res = await api().patch("/api/users/current").set("Authorization", token).send({});

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe(user.name);
  });

  it("rejects an invalid password and leaves the user unchanged", async () => {
    const user = await createUser();
    const { token } = await login(user);
    const before = await prismaClient.users.findUniqueOrThrow({ where: { username: user.username } });

    const res = await api().patch("/api/users/current").set("Authorization", token).send({ name: "Bonzz", password: "short" });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(validationError);
    const after = await prismaClient.users.findUniqueOrThrow({ where: { username: user.username } });
    expect(after).toEqual(before);
  });

  it("cannot be used to change the username or the stored refresh token", async () => {
    const user = await createUser();
    const { token } = await login(user);
    const before = await prismaClient.users.findUniqueOrThrow({ where: { username: user.username } });

    await api().patch("/api/users/current").set("Authorization", token).send({ username: "takeover1", token: "forged" });

    const after = await prismaClient.users.findUniqueOrThrow({ where: { username: user.username } });
    expect(after.token).toBe(before.token);
    expect(await prismaClient.users.findUnique({ where: { username: "takeover1" } })).toBeNull();
  });

  it("requires authentication", async () => {
    const res = await api().patch("/api/users/current").send({ name: "Bonzz" });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ errors: "Unauthorized" });
  });
});

describe("DELETE /api/users/logout", () => {
  it("revokes the stored refresh token", async () => {
    const user = await createUser();
    const { token } = await login(user);

    const res = await api().delete("/api/users/logout").set("Authorization", token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: "logout success" });
    const row = await prismaClient.users.findUniqueOrThrow({ where: { username: user.username } });
    expect(row.token).toBeNull();
  });

  it("requires authentication", async () => {
    const res = await api().delete("/api/users/logout").set("Authorization", "test");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ errors: "Invalid token" });
  });
});
