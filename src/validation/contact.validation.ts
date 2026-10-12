import { z } from "zod";
import { idSchema } from "./common.validation";

export class contactValidation {
  static readonly create = z.object({
    firstName: z.string().min(4).max(100),
    lastName: z.string().min(4).max(100),
    email: z.string().email().optional(),
    phone: z.string().min(12).max(16),
  })

  static readonly get = idSchema

  static readonly update = z.object({
    id: idSchema,
    firstName: z.string().min(4).max(100).optional(),
    lastName: z.string().min(4).max(100).optional(),
    email: z.string().email().optional(),
    phone: z.string().min(12).max(16).optional(),
  })

  static readonly search = z.object({
    name: z.string().min(1).optional(),
    email: z.string().min(1).email().optional(),
    phone: z.string().min(1).max(16).optional(),
    page: z.number().int().min(1),
    size: z.number().int().min(1).max(100)
  })
}