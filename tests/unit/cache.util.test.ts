import { cacheKey } from "../../src/utils/cache.util";

describe("cacheKey", () => {
  it("builds namespaced keys", () => {
    expect(cacheKey.user("alice")).toBe("user:alice");
    expect(cacheKey.contact("alice", 3)).toBe("contact:alice:3");
    expect(cacheKey.address("alice", 3, 7)).toBe("address:alice:3:7");
    expect(cacheKey.addressList("alice", 3)).toBe("address-list:alice:3");
  });

  it("does not collide for users whose names are prefixes of each other", () => {
    // With the old `username + id` scheme both of these were "testuser12".
    expect(cacheKey.contact("testuser1", 2)).not.toBe(cacheKey.contact("testuser", 12));
    expect(cacheKey.address("testuser1", 2, 3)).not.toBe(cacheKey.address("testuser", 12, 3));
  });

  it("does not collide across resource types", () => {
    const keys = [
      cacheKey.user("alice"),
      cacheKey.contact("alice", 1),
      cacheKey.address("alice", 1, 1),
      cacheKey.addressList("alice", 1),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("encodes separators inside usernames so they cannot forge another key", () => {
    expect(cacheKey.contact("a:1", 2)).not.toBe(cacheKey.contact("a", 12));
    expect(cacheKey.contact("a:1", 2)).toBe("contact:a%3A1:2");
  });
});
