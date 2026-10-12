import bcrypt from "bcrypt";
import { addresses, contacts } from "@prisma/client";
import { prismaClient } from "../../src/app/database";

export const DEFAULT_PASSWORD = "password123";

export type TestUser = {
  username: string;
  password: string;
  name: string;
};

/** Insert a user straight into the database (bypasses the API and validation). */
export async function createUser(
  overrides: Partial<TestUser> = {}
): Promise<TestUser> {
  const user: TestUser = {
    username: "testuser1",
    password: DEFAULT_PASSWORD,
    name: "Test User",
    ...overrides,
  };

  await prismaClient.users.create({
    data: {
      username: user.username,
      // low cost factor keeps the suite fast; compare() works with any cost
      password: await bcrypt.hash(user.password, 4),
      name: user.name,
    },
  });

  return user;
}

export async function createContact(
  username: string,
  overrides: Partial<Omit<contacts, "username">> = {}
): Promise<contacts> {
  return prismaClient.contacts.create({
    data: {
      firstName: "Jane",
      lastName: "Doe",
      email: "jane.doe@example.com",
      phone: "081234567890",
      ...overrides,
      username,
    },
  });
}

export async function createAddress(
  contactId: number,
  overrides: Partial<Omit<addresses, "contactId">> = {}
): Promise<addresses> {
  return prismaClient.addresses.create({
    data: {
      street: "Jl. Merdeka 1",
      city: "Bekasi",
      province: "Jawa Barat",
      country: "Indonesia",
      postalCode: "17111",
      ...overrides,
      contactId,
    },
  });
}
