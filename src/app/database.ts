import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";

// Load .env before reading REDIS_URL below (imports are evaluated first).
dotenv.config({ quiet: true });

export const prismaClient = new PrismaClient();

export const redis = new Redis(
  process.env.REDIS_URL ?? "redis://localhost:6379/0"
);
