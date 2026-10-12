import supertest from "supertest";
import { app } from "../../src/app/web";

describe("health endpoints (real database and Redis)", () => {
  it("GET /health is public", async () => {
    const res = await supertest(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("GET /ready confirms the database and Redis are reachable", async () => {
    const res = await supertest(app).get("/ready");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", checks: { database: true, redis: true } });
  });
});
