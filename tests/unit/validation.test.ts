import { z } from "zod";
import { Validation } from "../../src/validation/validation";
import { userValidation } from "../../src/validation/user.validation";
import { contactValidation } from "../../src/validation/contact.validation";
import { addressValidation } from "../../src/validation/address.validation";
import { MAX_ID } from "../../src/validation/common.validation";

const accepts = (schema: z.ZodType, value: unknown) =>
  schema.safeParse(value).success;

describe("Validation.validate", () => {
  const schema = z.object({ name: z.string() });

  it("returns the parsed value", async () => {
    await expect(Validation.validate(schema, { name: "a" })).resolves.toEqual({
      name: "a",
    });
  });

  it("strips keys that are not part of the schema (no mass assignment)", async () => {
    const result = await Validation.validate(schema, {
      name: "a",
      username: "hacker",
      id: 1,
    });
    expect(result).toEqual({ name: "a" });
  });

  it("rejects with a ZodError for invalid input", async () => {
    await expect(Validation.validate(schema, { name: 1 })).rejects.toBeInstanceOf(
      z.ZodError
    );
  });
});

describe("id schema", () => {
  const schema = contactValidation.get;

  it.each([1, 2, 1000, MAX_ID])("accepts %p", (id) => {
    expect(accepts(schema, id)).toBe(true);
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
    ["above the 32-bit limit", MAX_ID + 1],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["a numeric string", "1"],
    ["null", null],
    ["undefined", undefined],
  ])("rejects %s", (_label, id) => {
    expect(accepts(schema, id)).toBe(false);
  });
});

describe("userValidation.register", () => {
  const valid = { username: "testuser", password: "password", name: "Test" };

  it("accepts a valid payload", () => {
    expect(accepts(userValidation.register, valid)).toBe(true);
  });

  it("accepts the boundary lengths", () => {
    expect(
      accepts(userValidation.register, {
        username: "a".repeat(8),
        password: "b".repeat(8),
        name: "c",
      })
    ).toBe(true);
    expect(
      accepts(userValidation.register, {
        username: "a".repeat(100),
        password: "b".repeat(100),
        name: "c".repeat(100),
      })
    ).toBe(true);
  });

  it.each([
    ["username shorter than 8", { username: "a".repeat(7) }],
    ["username longer than 100", { username: "a".repeat(101) }],
    ["password shorter than 8", { password: "b".repeat(7) }],
    ["password longer than 100", { password: "b".repeat(101) }],
    ["empty name", { name: "" }],
    ["name longer than 100", { name: "c".repeat(101) }],
    ["missing name", { name: undefined }],
    ["missing username", { username: undefined }],
    ["non-string password", { password: 12345678 }],
  ])("rejects %s", (_label, patch) => {
    expect(accepts(userValidation.register, { ...valid, ...patch })).toBe(false);
  });
});

describe("userValidation.login", () => {
  it("requires username and password", () => {
    expect(accepts(userValidation.login, { username: "testuser", password: "password" })).toBe(true);
    expect(accepts(userValidation.login, { username: "testuser" })).toBe(false);
    expect(accepts(userValidation.login, { password: "password" })).toBe(false);
    expect(accepts(userValidation.login, {})).toBe(false);
  });
});

describe("userValidation.update", () => {
  it("accepts any subset of fields, including none", () => {
    expect(accepts(userValidation.update, {})).toBe(true);
    expect(accepts(userValidation.update, { name: "New" })).toBe(true);
    expect(accepts(userValidation.update, { password: "newpassword" })).toBe(true);
  });

  it("still validates the fields that are present", () => {
    expect(accepts(userValidation.update, { password: "short" })).toBe(false);
    expect(accepts(userValidation.update, { name: "" })).toBe(false);
  });
});

describe("contactValidation.create", () => {
  const valid = {
    firstName: "John",
    lastName: "Doee",
    email: "john@example.com",
    phone: "081234567890",
  };

  it("accepts a valid payload, with or without email", () => {
    expect(accepts(contactValidation.create, valid)).toBe(true);
    expect(accepts(contactValidation.create, { ...valid, email: undefined })).toBe(true);
  });

  it.each([
    ["firstName shorter than 4", { firstName: "Jo" }],
    ["lastName missing", { lastName: undefined }],
    ["invalid email", { email: "not-an-email" }],
    ["phone shorter than 12", { phone: "0812345678" }],
    ["phone longer than 16", { phone: "0".repeat(17) }],
    ["phone missing", { phone: undefined }],
  ])("rejects %s", (_label, patch) => {
    expect(accepts(contactValidation.create, { ...valid, ...patch })).toBe(false);
  });
});

describe("contactValidation.update", () => {
  it("requires an id but every other field is optional", () => {
    expect(accepts(contactValidation.update, { id: 1 })).toBe(true);
    expect(accepts(contactValidation.update, { id: 1, firstName: "Johnny" })).toBe(true);
    expect(accepts(contactValidation.update, {})).toBe(false);
    expect(accepts(contactValidation.update, { id: 1, firstName: "Jo" })).toBe(false);
  });
});

describe("contactValidation.search", () => {
  it("accepts paging with optional filters", () => {
    expect(accepts(contactValidation.search, { page: 1, size: 10 })).toBe(true);
    expect(accepts(contactValidation.search, { page: 3, size: 100, name: "a", email: "a@b.co", phone: "08" })).toBe(true);
  });

  it.each([
    ["page 0", { page: 0, size: 10 }],
    ["fractional page", { page: 1.5, size: 10 }],
    ["size 0", { page: 1, size: 0 }],
    ["size above 100", { page: 1, size: 101 }],
    ["empty name filter", { page: 1, size: 10, name: "" }],
    ["invalid email filter", { page: 1, size: 10, email: "nope" }],
    ["missing paging", {}],
  ])("rejects %s", (_label, value) => {
    expect(accepts(contactValidation.search, value)).toBe(false);
  });
});

describe("addressValidation", () => {
  const valid = {
    street: "Jl. Merdeka",
    city: "Bekasi",
    province: "Jawa Barat",
    country: "Indonesia",
    postalCode: "17111",
    contactId: 1,
  };

  it("create accepts a full payload and only requires country, postalCode and contactId", () => {
    expect(accepts(addressValidation.create, valid)).toBe(true);
    expect(
      accepts(addressValidation.create, {
        country: "Indonesia",
        postalCode: "17111",
        contactId: 1,
      })
    ).toBe(true);
  });

  it.each([
    ["missing country", { country: undefined }],
    ["missing postalCode", { postalCode: undefined }],
    ["missing contactId", { contactId: undefined }],
    ["postalCode shorter than 4", { postalCode: "123" }],
    ["postalCode longer than 10", { postalCode: "1".repeat(11) }],
    ["street shorter than 4", { street: "ab" }],
    ["invalid contactId", { contactId: 0 }],
  ])("create rejects %s", (_label, patch) => {
    expect(accepts(addressValidation.create, { ...valid, ...patch })).toBe(false);
  });

  it("get requires a valid id and contactId", () => {
    expect(accepts(addressValidation.get, { id: 1, contactId: 1 })).toBe(true);
    expect(accepts(addressValidation.get, { id: 1 })).toBe(false);
    expect(accepts(addressValidation.get, { id: 0, contactId: 1 })).toBe(false);
  });

  it("update requires id and contactId, everything else is optional", () => {
    expect(accepts(addressValidation.update, { id: 1, contactId: 1 })).toBe(true);
    expect(accepts(addressValidation.update, { id: 1, contactId: 1, city: "Jakarta" })).toBe(true);
    expect(accepts(addressValidation.update, { contactId: 1 })).toBe(false);
    expect(accepts(addressValidation.update, { id: 1, contactId: 1, postalCode: "1" })).toBe(false);
  });

  it("list takes a single contact id", () => {
    expect(accepts(addressValidation.list, 5)).toBe(true);
    expect(accepts(addressValidation.list, "5")).toBe(false);
    expect(accepts(addressValidation.list, NaN)).toBe(false);
  });
});
