import { z } from "zod";
import { idSchema } from "./common.validation";

export class addressValidation {
  static create = z.object({
    street: z.string().min(4).max(100).optional(),
    city: z.string().min(4).max(100).optional(),
    province: z.string().min(4).max(100).optional(),
    country: z.string().min(4).max(100),
    postalCode: z.string().min(4).max(10),
    contactId: idSchema,
  });

  static get = z.object({
    id: idSchema,
    contactId: idSchema,
  });

  static update = z.object({
    id: idSchema,
    street: z.string().min(4).max(100).optional(),
    city: z.string().min(4).max(100).optional(),
    province: z.string().min(4).max(100).optional(),
    country: z.string().min(4).max(100).optional(),
    postalCode: z.string().min(4).max(10).optional(),
    contactId: idSchema,
  });

  static list = idSchema
}
