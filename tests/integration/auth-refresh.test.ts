import jwt from "jsonwebtoken";
import supertest from "supertest";
import { app } from "../../src/app/web";
import { prismaClient } from "../../src/app/database";
import {
  expiredAccessToken,
  expiredRefreshToken,
  login,
  signedRefreshCookie,
} from "../helpers/auth";
import { resetState } from "../helpers/db";
import { createUser } from "../helpers/factories";

const api = () => supertest(app);

beforeEach(resetState);

const getCurrent = (token: string, cookie?: string) => {
  const req = api().get("/api/users/current").set("Authorization", token);
  return cookie ? req.set("Cookie", cookie) : req;
};

describe("access token refresh", () => {
  it("issues a new access token when the access token expired but the refresh token is valid", async () => {
    const user = await createUser();
    const { cookie } = await login(user);

    const res = await getCurrent(expiredAccessToken(user.username), cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.username).toBe(user.username);
    expect(res.body.newAccessToken).toEqual(expect.any(String));
  });

  it("the new access token is valid, expiring, and usable on the next request", async () => {
    const user = await createUser();
    const { cookie } = await login(user);
    const refreshed = await getCurrent(expiredAccessToken(user.username), cookie);

    const payload = jwt.verify(refreshed.body.newAccessToken, process.env.SECRET_KEY as string) as jwt.JwtPayload;
    expect(payload.username).toBe(user.username);
    expect(payload.exp! - payload.iat!).toBe(3600);

    const next = await getCurrent(refreshed.body.newAccessToken);
    expect(next.status).toBe(200);
    expect(next.body.newAccessToken).toBeUndefined();
  });

  it("works on every protected endpoint, not just the profile", async () => {
    const user = await createUser();
    const { cookie } = await login(user);

    const res = await api()
      .get("/api/contacts")
      .query({ page: 1, size: 10 })
      .set("Authorization", expiredAccessToken(user.username))
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.newAccessToken).toEqual(expect.any(String));
  });

  it("asks for a refresh token when the cookie is missing", async () => {
    const user = await createUser();

    const res = await getCurrent(expiredAccessToken(user.username));

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ errors: "No refresh token found" });
  });

  it("ignores a refresh cookie that was not signed by the server", async () => {
    const user = await createUser();
    const { cookie } = await login(user);
    const stored = await prismaClient.users.findUniqueOrThrow({ where: { username: user.username } });
    expect(cookie).toBeTruthy();

    // same token, but sent as a plain (unsigned) cookie
    const res = await getCurrent(expiredAccessToken(user.username), `refreshToken=${stored.token}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ errors: "No refresh token found" });
  });

  it("rejects a refresh token after logout", async () => {
    const user = await createUser();
    const { token, cookie } = await login(user);
    await api().delete("/api/users/logout").set("Authorization", token);

    const res = await getCurrent(expiredAccessToken(user.username), cookie);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ errors: "Unauthorized" });
  });

  it("rejects another user's refresh token", async () => {
    const alice = await createUser({ username: "alice123" });
    const bob = await createUser({ username: "bob12345" });
    const { cookie: bobCookie } = await login(bob);

    const res = await getCurrent(expiredAccessToken(alice.username), bobCookie);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ errors: "Unauthorized" });
  });

  it("revokes an expired refresh token and rejects the request", async () => {
    const user = await createUser();
    const expired = expiredRefreshToken(user.username);
    await prismaClient.users.update({ where: { username: user.username }, data: { token: expired } });

    const res = await getCurrent(expiredAccessToken(user.username), signedRefreshCookie(expired));

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ errors: "Unauthorized" });
    const row = await prismaClient.users.findUniqueOrThrow({ where: { username: user.username } });
    expect(row.token).toBeNull();
  });

  it("does not refresh anything for a tampered access token", async () => {
    const user = await createUser();
    const { cookie } = await login(user);
    const tampered = expiredAccessToken(user.username).slice(0, -3) + "abc";

    const res = await getCurrent(tampered, cookie);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ errors: "Invalid token" });
  });
});