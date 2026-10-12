import { addresses, contacts, users } from "@prisma/client";
import {
  toAddressResponse,
  toContactResponse,
  toUserResponse,
} from "../../src/utils/response.util";

describe("toUserResponse", () => {
  const user = { username: "alice123", name: "Alice", password: "hash", token: "t" } as users;

  it("exposes only username and name", () => {
    const res = toUserResponse(user);
    expect(res).toEqual({ data: { username: "alice123", name: "Alice" }, newAccessToken: undefined });
    expect(JSON.stringify(res)).not.toContain("hash");
  });

  it("passes the refreshed access token through", () => {
    expect(toUserResponse(user, { username: "alice123", newAccessToken: "new" }).newAccessToken).toBe("new");
  });
});

describe("toContactResponse", () => {
  it("maps a full row", () => {
    const row = { id: 1, firstName: "Jane", lastName: "Doe", email: "j@d.co", phone: "0812", username: "alice123" } as contacts;
    expect(toContactResponse(row).data).toEqual({ id: 1, firstName: "Jane", lastName: "Doe", email: "j@d.co", phone: "0812" });
  });

  it("turns null columns into undefined so they are omitted from the JSON", () => {
    const row = { id: 1, firstName: "Jane", lastName: null, email: null, phone: null, username: "alice123" } as contacts;
    const data = toContactResponse(row).data;
    expect(data.lastName).toBeUndefined();
    expect(data.email).toBeUndefined();
    expect(JSON.parse(JSON.stringify(data))).toEqual({ id: 1, firstName: "Jane" });
  });

  it("never leaks the owner's username", () => {
    const row = { id: 1, firstName: "Jane", lastName: null, email: null, phone: null, username: "alice123" } as contacts;
    expect(JSON.stringify(toContactResponse(row))).not.toContain("alice123");
  });
});

describe("toAddressResponse", () => {
  it("maps a row and drops null columns and the contact id", () => {
    const row = { id: 9, street: null, city: "Bekasi", province: null, country: "Indonesia", postalCode: "17111", contactId: 5 } as addresses;
    const res = toAddressResponse(row, { username: "alice123", newAccessToken: "new" });
    expect(res.newAccessToken).toBe("new");
    expect(JSON.parse(JSON.stringify(res.data))).toEqual({ id: 9, city: "Bekasi", country: "Indonesia", postalCode: "17111" });
  });
});
