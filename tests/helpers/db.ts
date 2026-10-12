import { prismaClient, redis } from "../../src/app/database";

const CACHE_PATTERNS = ["user:*", "contact:*", "address:*", "address-list:*"];

/** Remove every cache entry the application can create. */
export async function clearCache(): Promise<void> {
  for (const pattern of CACHE_PATTERNS) {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) await redis.del(...keys);
  }
}

/**
 * Bring the test database and cache back to an empty state.
 * Tables are cleared children-first because of the foreign keys.
 */
export async function resetState(): Promise<void> {
  await prismaClient.addresses.deleteMany();
  await prismaClient.contacts.deleteMany();
  await prismaClient.users.deleteMany();
  await clearCache();
}

export async function cacheKeys(): Promise<string[]> {
  const all: string[] = [];
  for (const pattern of CACHE_PATTERNS) {
    all.push(...(await redis.keys(pattern)));
  }
  return all.sort();
}
