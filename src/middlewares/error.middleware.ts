import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { ResponseError } from "../utils/Error.util";

type BodyParserError = Error & { type?: string };

export const errorMiddleware = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (error instanceof ZodError) {
    res.status(400).json({
      errors: `Validation Error: ${JSON.stringify(error)}`,
    });
    return;
  }
  if (error instanceof ResponseError) {
    res.status(error.status).json({
      errors: error.message,
    });
    return;
  }
  if ((error as BodyParserError).type === "entity.parse.failed") {
    res.status(400).json({ errors: "Invalid JSON body" });
    return;
  }
  if ((error as BodyParserError).type === "entity.too.large") {
    res.status(413).json({ errors: "Request body is too large" });
    return;
  }
  console.error(error);
  res.status(500).json({ errors: "InternalServerError" });
};