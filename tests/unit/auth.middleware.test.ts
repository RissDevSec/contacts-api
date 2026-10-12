import { Response } from "express";
import jwt, { TokenExpiredError } from "jsonwebtoken";
import { authMiddleware } from "../../src/middlewares/auth.middleware";
import { UserRequest } from "../../src/utils/token.util";

const secret = () => process.env.SECRET_KEY as string;

function run(token?: string) {
  const req = {
    get: (name: string) => (name === "Authorization" ? token : undefined),
  } as unknown as UserRequest;
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();
  return authMiddleware(req, res as unknown as Response, next).then(() => ({ req, res, next }));
}

describe("authMiddleware", () => {
  it("rejects a request without an Authorization header", async () => {
    const { res, next } = await run(undefined);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ errors: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts a valid token and exposes the username", async () => {
    const { req, res, next } = await run(jwt.sign({ username: "alice123" }, secret(), { expiresIn: "1h" }));
    expect(req.user?.username).toBe("alice123");
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("forwards an expired token as TokenExpiredError so it can be refreshed", async () => {
    const { req, next } = await run(jwt.sign({ username: "alice123" }, secret(), { expiresIn: -60 }));
    expect(req.user?.username).toBe("alice123");
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(TokenExpiredError);
  });

  it.each([
    ["garbage", "test"],
    ["signed with another secret", jwt.sign({ username: "alice123" }, "another-secret")],
    ["unsigned (alg none)", jwt.sign({ username: "alice123" }, "", { algorithm: "none" })],
    ["tampered payload", (() => {
      const [h, , s] = jwt.sign({ username: "alice123" }, secret()).split(".");
      const payload = Buffer.from(JSON.stringify({ username: "bob12345" })).toString("base64url");
      return `${h}.${payload}.${s}`;
    })()],
  ])("rejects a token that is %s", async (_label, token) => {
    const { res, next } = await run(token);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ errors: "Invalid token" });
    expect(next).not.toHaveBeenCalled();
  });
});