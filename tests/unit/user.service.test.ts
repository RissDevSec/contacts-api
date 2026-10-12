import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { UserService } from "../../src/services/user.service";
import { ResponseError } from "../../src/utils/Error.util";
import type { MockDatabase } from "../helpers/mockDatabase";

jest.mock("../../src/app/database", () =>
  require("../helpers/mockDatabase").createMockDatabase()
);

import { prismaClient, redis } from "../../src/app/database";
const db = prismaClient as unknown as MockDatabase["prismaClient"];
const cache = redis as unknown as MockDatabase["redis"];

const caller = { username: "alice123" };

describe("UserService.register", () => {
  const request = { username: "alice123", password: "password123", name: "Alice" };

  it("stores a bcrypt hash, never the plain password, and does not return it", async () => {
    db.users.count.mockResolvedValue(0);
    db.users.create.mockImplementation(async ({ data }) => data);

    const res = await UserService.register({ ...request });

    const stored = db.users.create.mock.calls[0][0].data;
    expect(stored.password).not.toBe("password123");
    expect(await bcrypt.compare("password123", stored.password)).toBe(true);
    expect(res).toEqual({ data: { username: "alice123", name: "Alice" }, newAccessToken: undefined });
    expect(JSON.stringify(res)).not.toContain("password");
  });

  it("rejects a username that is taken", async () => {
    db.users.count.mockResolvedValue(1);

    await expect(UserService.register({ ...request })).rejects.toMatchObject({
      message: "Username already exists",
      status: 409,
    });
    expect(db.users.create).not.toHaveBeenCalled();
  });

  it("rejects invalid input before touching the database", async () => {
    await expect(UserService.register({ username: "x", password: "y", name: "" })).rejects.toBeInstanceOf(z.ZodError);
    expect(db.users.count).not.toHaveBeenCalled();
  });
});

describe("UserService.login", () => {
  let hash: string;
  beforeAll(async () => {
    hash = await bcrypt.hash("password123", 4);
  });

  const row = (token: string | null = null) => ({ username: "alice123", name: "Alice", password: hash, token });

  it("rejects an unknown username", async () => {
    db.users.findUnique.mockResolvedValue(null);
    await expect(UserService.login({ username: "nobody123", password: "password123" })).rejects.toMatchObject({
      message: "Invalid credentials",
      status: 401,
    });
  });

  it("rejects a wrong password", async () => {
    db.users.findUnique.mockResolvedValue(row());
    await expect(UserService.login({ username: "alice123", password: "wrongpassword" })).rejects.toMatchObject({
      message: "Invalid credentials",
      status: 401,
    });
    expect(db.users.update).not.toHaveBeenCalled();
  });

  it("issues an expiring access token and a stored refresh token on first login", async () => {
    db.users.findUnique.mockResolvedValue(row());

    const res = await UserService.login({ username: "alice123", password: "password123" });

    const access = jwt.verify(res.accessToken!, process.env.SECRET_KEY as string) as jwt.JwtPayload;
    expect(access.username).toBe("alice123");
    expect(access.exp! - access.iat!).toBe(3600);

    const refresh = jwt.verify(res.refreshToken!, process.env.SECRET_KEY_DATABASE as string) as jwt.JwtPayload;
    expect(refresh.username).toBe("alice123");
    expect(db.users.update).toHaveBeenCalledWith({ where: { username: "alice123" }, data: { token: res.refreshToken } });
    expect(JSON.stringify(res)).not.toContain(hash);
  });

  it("reuses the refresh token that is already stored", async () => {
    db.users.findUnique.mockResolvedValue(row("existing-refresh-token"));

    const res = await UserService.login({ username: "alice123", password: "password123" });

    expect(res.refreshToken).toBe("existing-refresh-token");
    expect(db.users.update).not.toHaveBeenCalled();
  });
});

describe("UserService.get", () => {
  it("serves from the cache without querying the database", async () => {
    cache.get.mockResolvedValue(JSON.stringify({ username: "alice123", name: "Cached" }));

    const res = await UserService.get(caller);

    expect(res.data).toEqual({ username: "alice123", name: "Cached" });
    expect(cache.get).toHaveBeenCalledWith("user:alice123");
    expect(db.users.findUnique).not.toHaveBeenCalled();
  });

  it("on a miss caches only the public fields", async () => {
    cache.get.mockResolvedValue(null);
    db.users.findUnique.mockResolvedValue({ username: "alice123", name: "Alice", password: "secret-hash", token: "refresh" });

    const res = await UserService.get(caller);

    expect(res.data).toEqual({ username: "alice123", name: "Alice" });
    const [key, ttl, value] = cache.setex.mock.calls[0];
    expect(key).toBe("user:alice123");
    expect(ttl).toBe(3600);
    expect(JSON.parse(value)).toEqual({ username: "alice123", name: "Alice" });
    expect(value).not.toContain("secret-hash");
    expect(value).not.toContain("refresh");
  });

  it("answers 404 for a user that no longer exists and caches nothing", async () => {
    cache.get.mockResolvedValue(null);
    db.users.findUnique.mockResolvedValue(null);

    await expect(UserService.get(caller)).rejects.toBeInstanceOf(ResponseError);
    expect(cache.setex).not.toHaveBeenCalled();
  });
});

describe("UserService.update", () => {
  it("hashes a new password and invalidates the cache", async () => {
    db.users.update.mockImplementation(async ({ data }) => ({ username: "alice123", name: "Alice", ...data }));

    await UserService.update(caller, { password: "newpassword123" });

    const data = db.users.update.mock.calls[0][0].data;
    expect(data.password).not.toBe("newpassword123");
    expect(await bcrypt.compare("newpassword123", data.password)).toBe(true);
    expect(cache.del).toHaveBeenCalledWith("user:alice123");
  });

  it("leaves the password alone when only the name changes", async () => {
    db.users.update.mockImplementation(async ({ data }) => ({ username: "alice123", ...data }));

    const res = await UserService.update(caller, { name: "New Name" });

    expect(db.users.update.mock.calls[0][0].data).toEqual({ name: "New Name" });
    expect(res.data.name).toBe("New Name");
  });

  it("is scoped to the authenticated user", async () => {
    db.users.update.mockResolvedValue({ username: "alice123", name: "Alice" });
    await UserService.update(caller, { name: "Another" });
    expect(db.users.update.mock.calls[0][0].where).toEqual({ username: "alice123" });
  });

  it("rejects an invalid password without updating", async () => {
    await expect(UserService.update(caller, { password: "short" })).rejects.toBeInstanceOf(z.ZodError);
    expect(db.users.update).not.toHaveBeenCalled();
  });
});

describe("UserService.logout", () => {
  it("revokes the stored refresh token", async () => {
    await UserService.logout(caller);
    expect(db.users.update).toHaveBeenCalledWith({ where: { username: "alice123" }, data: { token: null } });
  });
});