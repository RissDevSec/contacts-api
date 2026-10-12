/**
 * Redis cache key builders.
 *
 * Every key is namespaced by type and the username is URI-encoded, so keys of
 * different users (or different resource types) can never collide.
 */
const u = (username: string): string => encodeURIComponent(username);

export const cacheKey = {
  user: (username: string): string => `user:${u(username)}`,
  contact: (username: string, contactId: number): string =>
    `contact:${u(username)}:${contactId}`,
  address: (username: string, contactId: number, addressId: number): string =>
    `address:${u(username)}:${contactId}:${addressId}`,
  addressList: (username: string, contactId: number): string =>
    `address-list:${u(username)}:${contactId}`,
};
