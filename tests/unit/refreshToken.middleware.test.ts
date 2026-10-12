import { Response } from "express";
import jwt, { TokenExpiredError } from "jsonwebtoken";
import { refreshToken } from "../../src/middlewares/refreshToken.middleware";
import { UserRequest } from "../../src/utils/token.util";
import type { MockDatabase } from "../helpers/mockDatabase";

jest.mock("../../src/app/database", () =>
  require("../helpers/mockDatabase").createMockDatabase()
);

import { prismaClient } from "../../src/app/database";
const db = prismaClient as unknown as MockDatabase["prismaClient"];

const refreshSecret = () => process.env.SECRET_KEY_DATABASE as string;
const expired = () => new TokenExpiredError("jwt expired", new Date());

async function run(error: Error | undefined, cookie?: string, username = "alice123") {
  const req = {
    user: { username },
    signedCookies: cookie ? { refreshToken: cookie } : {},
  } as unknown as UserRequest;
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();
  await refreshToken(error as Error, req, res as unknown as Response, next);
  return { req, res, next };
}

describe("refreshToken middleware", () => {
  it("lets the request through when there is no error", async () => {
    const { next } = await run(undefined);
    expect(next).toHaveBeenCalledWith();
  });

  it("passes unrelated errors on untouched", async () => {
    const error = new Error("boom");
    const { next, res } = await run(error);
    expect(next).toHaveBeenCalledWith(error);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("asks for a refresh token when the cookie is missing", async () => {
    const { res, next } = await run(expired());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ errors: "No refresh token found" });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a refresh token that is not stored for this user", async () => {
    db.users.findUnique.mockResolvedValue(null);
    const { res, next } = await run(expired(), "some-token");
    expect(db.users.findUnique).toHaveBeenCalledWith({ where: { username: "alice123", token: "some-token" } });
    expect(res.json).toHaveBeenCalledWith({ errors: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });

  it("issues a new, expiring access token for a valid refresh token", async () => {
    const token = jwt.sign({ username: "alice123" }, refreshSecret(), { expiresIn: "1d" });
    db.users.findUnique.mockResolvedValue({ username: "alice123", token });

    const { req, next } = await run(expired(), token);

    expect(next).toHaveBeenCalledWith();
    const decoded = jwt.verify(req.user!.newAccessToken!, process.env.SECRET_KEY as string) as jwt.JwtPayload;
    expect(decoded.username).toBe("alice123");
    expect(decoded.exp).toBeDefined();
    expect(decoded.exp! - decoded.iat!).toBe(3600);
  });

  it("rejects a refresh token that belongs to a different user", async () => {
    const token = jwt.sign({ username: "mallory1" }, refreshSecret(), { expiresIn: "1d" });
    db.users.findUnique.mockResolvedValue({ username: "alice123", token });

    const { res, next } = await run(expired(), token);
    expect(res.json).toHaveBeenCalledWith({ errors: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });

  it("revokes an expired refresh token and rejects the request", async () => {
    const token = jwt.sign({ username: "alice123" }, refreshSecret(), { expiresIn: -60 });
    db.users.findUnique.mockResolvedValue({ username: "alice123", token });

    const { res, next } = await run(expired(), token);

    expect(db.users.update).toHaveBeenCalledWith({ where: { username: "alice123" }, data: { token: null } });
    expect(res.json).toHaveBeenCalledWith({ errors: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a forged refresh token without touching the stored one", async () => {
    const token = jwt.sign({ username: "alice123" }, "another-secret");
    db.users.findUnique.mockResolvedValue({ username: "alice123", token });

    const { res } = await run(expired(), token);

    expect(db.users.update).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ errors: "Unauthorized" });
  });
});