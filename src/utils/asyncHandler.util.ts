import { NextFunction, Request, RequestHandler, Response } from "express";
import { UserRequest } from "./token.util";

/**
 * Wraps an async Express handler so any rejected promise is forwarded to the
 * error middleware, instead of repeating try/catch in every controller.
 */
export const asyncHandler =
  (
    fn: (req: UserRequest, res: Response, next: NextFunction) => unknown
  ): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as UserRequest, res, next)).catch(next);
  };