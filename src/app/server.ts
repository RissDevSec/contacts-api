import { app } from "./web";
import { prismaClient, redis } from "./database";

const port = Number(process.env.PORT) || 3000;

const server = app.listen(port, () => {
  console.log(`app start on port ${port}`);
});

const shutdown = (signal: string): void => {
  console.log(`${signal} received, shutting down`);
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();

  server.close(async () => {
    await prismaClient.$disconnect();
    redis.disconnect();
    process.exit(0);
  });
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
