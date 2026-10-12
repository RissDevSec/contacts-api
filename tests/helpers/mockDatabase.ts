/**
 * In-memory stand-in for `src/app/database`, used by unit tests.
 *
 * Usage (the factory runs lazily, so `require` inside it is fine):
 *
 *   jest.mock("../../src/app/database", () =>
 *     require("../helpers/mockDatabase").createMockDatabase()
 *   );
 */
export function createMockDatabase() {
  const model = () => ({
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  });

  return {
    prismaClient: {
      users: model(),
      contacts: model(),
      addresses: model(),
      $queryRaw: jest.fn(),
      $disconnect: jest.fn(),
    },
    redis: {
      get: jest.fn(),
      setex: jest.fn(),
      del: jest.fn(),
      ping: jest.fn(),
      disconnect: jest.fn(),
    },
  };
}

export type MockDatabase = ReturnType<typeof createMockDatabase>;
