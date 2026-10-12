import { z } from "zod";

export class userValidation {
  static readonly register = z.object({
    username: z.string().min(8).max(100),
    password: z.string().min(8).max(100),
    name: z.string().min(1).max(100),
  });

  static readonly login = z.object({
    username: z.string().min(8).max(100),
    password: z.string().min(8).max(100),
  });

  static readonly update = z.object({
    name: z.string().min(1).max(100).optional(),
    password: z.string().min(8).max(100).optional()
  })
}