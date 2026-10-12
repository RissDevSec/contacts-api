import crypto from "crypto";
import jwt from "jsonwebtoken";
import supertest from "supertest";
import { app } from "../../src/app/web";
import { TestUser } from "./factories";

export type Session = {
  /** Value for the `Authorization` header (this API uses the raw JWT). */
  token: string;
  /** Value for the `Cookie` header, e.g. `refreshToken=s%3A...`. */
  cookie: string;
};

/** Log in through the real API, exactly like a client would. */
export async function login(user: TestUser): Promise<Session> {
  const res = await supertest(app)
    .post("/api/users/login")
    .send({ username: user.username, password: user.password });

  if (res.status !== 200) {
    throw new Error(`login helper failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  const setCookie = res.headers["set-cookie"] as unknown as string[];
  return {
    token: res.body.accessToken,
    cookie: setCookie[0].split(";")[0],
  };
}

export function signAccessToken(username: string, secret?: string): string {
  return jwt.sign({ username }, secret ?? (process.env.SECRET_KEY as string), {
    expiresIn: "1h",
  });
}

/** A correctly signed access token that expired a minute ago. */
export function expiredAccessToken(username: string): string {
  return jwt.sign({ username }, process.env.SECRET_KEY as string, {
    expiresIn: -60,
  });
}

/** A correctly signed refresh token that expired a minute ago. */
export function expiredRefreshToken(username: string): string {
  return jwt.sign({ username }, process.env.SECRET_KEY_DATABASE as string, {
    expiresIn: -60,
  });
}

/**
 * Build a `Cookie` header value holding a refresh token signed the same way
 * cookie-parser does (`s:<value>.<hmac-sha256>`).
 */
export function signedRefreshCookie(refreshToken: string): string {
  const signature = crypto
    .createHmac("sha256", process.env.SECRET_KEY_COOKIE as string)
    .update(refreshToken)
    .digest("base64")
    .replace(/=+$/, "");
  return `refreshToken=${encodeURIComponent(`s:${refreshToken}.${signature}`)}`;
}
