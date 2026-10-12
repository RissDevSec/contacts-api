import { prismaClient, redis } from "../../src/app/database";

afterAll(async () => {
  await prismaClient.$disconnect();
  redis.disconnect();
});
