import { Response, NextFunction } from "express";
import jwt, { JsonWebTokenError, TokenExpiredError } from "jsonwebtoken";
import { prismaClient } from "../app/database";
import { tokenAndRefresh, UserRequest } from "../utils/token.util";

export const refreshToken = async (
  error: Error | null,
  req: UserRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // Only an expired access token triggers the refresh flow; anything else is
  // either a normal request or an error for the central error middleware.
  if (!(error instanceof TokenExpiredError)) {
    return error ? next(error) : next();
  }

  const refreshToken = req.signedCookies["refreshToken"];
  if (!refreshToken) {
    res.status(401).json({ errors: "No refresh token found" });
    return;
  }

  try {
    const stored = await prismaClient.users.findUnique({
      where: {
        username: req.user?.username,
        token: refreshToken,
      },
    });

    if (!stored) {
      res.status(401).json({ errors: "Unauthorized" });
      return;
    }

    const verifyToken = jwt.verify(
      refreshToken,
      process.env.SECRET_KEY_DATABASE as string
    ) as tokenAndRefresh;

    if (verifyToken.username !== req.user?.username) {
      res.status(401).json({ errors: "Unauthorized" });
      return;
    }

    req.user!.newAccessToken = jwt.sign(
      { username: verifyToken.username },
      process.env.SECRET_KEY as string,
      { expiresIn: "1h" }
    );
    next();
  } catch (e) {
    if (e instanceof TokenExpiredError) {
      // The stored refresh token is dead: revoke it and ask the client to
      // log in again.
      await prismaClient.users.update({
        where: {
          username: req.user?.username,
        },
        data: {
          token: null,
        },
      });
      res.status(401).json({ errors: "Unauthorized" });
      return;
    }

    if (e instanceof JsonWebTokenError) {
      res.status(401).json({ errors: "Unauthorized" });
      return;
    }

    // Any other error (e.g. a database failure) is not an authentication
    // problem; let the error middleware report it as a 500.
    next(e as Error);
  }
};