import { z } from "zod";

/** Largest value of a signed 32-bit INT, which is what the database uses for ids. */
export const MAX_ID = 2_147_483_647;

/** A database id: a whole number between 1 and MAX_ID. */
export const idSchema = z.number().int().min(1).max(MAX_ID);
