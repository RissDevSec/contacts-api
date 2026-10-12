import dotenv from "dotenv";

// Prisma reads DATABASE_URL from .env on its own; load it here so we can
// inspect the exact value Prisma is going to use.
dotenv.config({ path: ".env.test", quiet: true });

const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    "Integration tests need DATABASE_URL pointing to a dedicated TEST database " +
      "(for example mysql://root:pass@localhost:3306/contacts_test)."
  );
}

// Safety net: these tests delete every row in every table. Refuse to run
// against anything that is not clearly a test database.
const databaseName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));

if (!/test/i.test(databaseName)) {
  throw new Error(
    `Refusing to run integration tests against database "${databaseName}". ` +
      'The database name must contain "test" so real data can never be wiped.'
  );
}
