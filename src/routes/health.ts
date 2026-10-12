import express from "express";
import { prismaClient, redis } from "../app/database";

export const healthRouter = express.Router();

// Liveness: the process is up. Does not touch any dependency.
healthRouter.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// Readiness: the database and Redis are reachable.
healthRouter.get("/ready", async (_req, res) => {
  const checks = { database: false, redis: false };

  try {
    await prismaClient.$queryRaw`SELECT 1`;
    checks.database = true;
  } catch {
    checks.database = false;
  }

  try {
    checks.redis = (await redis.ping()) === "PONG";
  } catch {
    checks.redis = false;
  }

  const ready = checks.database && checks.redis;
  res.status(ready ? 200 : 503).json({
    status: ready ? "ok" : "unavailable",
    checks,
  });
});
