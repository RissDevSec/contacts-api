import { Response, NextFunction } from "express";
import jwt, { JsonWebTokenError, TokenExpiredError } from "jsonwebtoken";
import { tokenAndRefresh, UserRequest } from "../utils/token.util";

export const authMiddleware = async (
  req: UserRequest,
  res: Response,
  next: NextFunction
) => {
  const accessToken = req.get("Authorization")?.replace(/^Bearer\s+/i, "");

  if (!accessToken) {
    res.status(401).json({ errors: "Unauthorized" });
    return;
  }

  try {
    req.user = jwt.verify(
      accessToken,
      process.env.SECRET_KEY as string
    ) as tokenAndRefresh;
    next();
  } catch (e) {
    if (e instanceof TokenExpiredError) {
      req.user = jwt.decode(accessToken) as tokenAndRefresh;
      next(e);
    } else if (e instanceof JsonWebTokenError) {
      res.status(401).json({ errors: "Invalid token" });
    } else {
      res.status(401).json({ errors: "Unauthorized" });
    }
  }
};