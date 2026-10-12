import { z } from "zod";

export class Validation {
  static async validate<S extends z.ZodType>(
    schema: S,
    data: unknown
  ): Promise<z.output<S>> {
    return await schema.parseAsync(data);
  }
}
