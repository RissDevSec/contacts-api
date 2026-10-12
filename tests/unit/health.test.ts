import supertest from "supertest";
import type { MockDatabase } from "../helpers/mockDatabase";

jest.mock("../../src/app/database", () =>
  require("../helpers/mockDatabase").createMockDatabase()
);

import { app } from "../../src/app/web";
import { prismaClient, redis } from "../../src/app/database";

const db = prismaClient as unknown as MockDatabase["prismaClient"];
const cache = redis as unknown as MockDatabase["redis"];

describe("GET /health", () => {
  it("is public and does not depend on any backing service", async () => {
    db.$queryRaw.mockRejectedValue(new Error("db down"));
    const res = await supertest(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});

describe("GET /ready", () => {
  it("is ready when the database and Redis answer", async () => {
    db.$queryRaw.mockResolvedValue([{ 1: 1 }]);
    cache.ping.mockResolvedValue("PONG");

    const res = await supertest(app).get("/ready");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", checks: { database: true, redis: true } });
  });

  it("reports 503 when the database is down", async () => {
    db.$queryRaw.mockRejectedValue(new Error("db down"));
    cache.ping.mockResolvedValue("PONG");

    const res = await supertest(app).get("/ready");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "unavailable", checks: { database: false, redis: true } });
  });

  it("reports 503 when Redis is down", async () => {
    db.$queryRaw.mockResolvedValue([{ 1: 1 }]);
    cache.ping.mockRejectedValue(new Error("redis down"));

    const res = await supertest(app).get("/ready");
    expect(res.status).toBe(503);
    expect(res.body.checks).toEqual({ database: true, redis: false });
  });
});

describe("app wiring", () => {
  it("does not advertise the framework", async () => {
    const res = await supertest(app).get("/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("protects the rest of the API behind authentication", async () => {
    const res = await supertest(app).get("/api/contacts");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ errors: "Unauthorized" });
  });
});
