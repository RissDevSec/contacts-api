import { prismaClient, redis } from "../app/database";
import {
  createUserRequest,
  loginUserRequest,
  updateUserRequest,
  userResponse,
} from "../models/user.model";
import { toUserResponse } from "../utils/response.util";
import { userValidation } from "../validation/user.validation";
import { Validation } from "../validation/validation";
import bcrypt from "bcrypt";
import { ResponseError } from "../utils/Error.util";
import jwt from "jsonwebtoken";
import { users } from "@prisma/client";
import { tokenAndRefresh } from "../utils/token.util";
import { cacheKey } from "../utils/cache.util";

export class UserService {
  static async register(request: createUserRequest): Promise<userResponse> {
    const registerRequest = await Validation.validate(
      userValidation.register,
      request
    );
    const userUsed = await prismaClient.users.count({
      where: {
        username: registerRequest.username,
      },
    });

    if (userUsed > 0) {
      throw new ResponseError("Username already exists", 409);
    }

    registerRequest.password = await bcrypt.hash(registerRequest.password, 10);

    const data = await prismaClient.users.create({
      data: registerRequest,
    });

    return toUserResponse(data);
  }

  static async login(request: loginUserRequest): Promise<userResponse> {
    const loginRequest = await Validation.validate(
      userValidation.login,
      request
    );

    const exist = await prismaClient.users.findUnique({
      where: {
        username: loginRequest.username,
      },
    });

    if (!exist) {
      throw new ResponseError("Invalid credentials", 401);
    }

    const password = await bcrypt.compare(
      loginRequest.password,
      exist.password
    );

    if (!password) {
      throw new ResponseError("Invalid credentials", 401);
    }

    let refreshToken;
    if (!exist.token) {
      refreshToken = jwt.sign(
        { username: exist.username },
        process.env.SECRET_KEY_DATABASE as string,
        {
          expiresIn: "1 days",
        }
      );
      await prismaClient.users.update({
        where: {
          username: exist.username,
        },
        data: {
          token: refreshToken,
        },
      });
    }

    const accessToken = jwt.sign(
      { username: exist.username },
      process.env.SECRET_KEY as string,
      { expiresIn: "1h" }
    );

    const response = toUserResponse(exist);
    response.accessToken = accessToken;
    response.refreshToken = refreshToken || (exist.token as string);
    return response;
  }

  static async get(user: tokenAndRefresh): Promise<userResponse> {
    const key = cacheKey.user(user.username);
    const getData = await redis.get(key);
    let data: Pick<users, "username" | "name">;
    if (getData) {
      data = JSON.parse(getData);
    } else {
      const found = await prismaClient.users.findUnique({
        where: {
          username: user.username,
        },
      });
      if (!found) {
        throw new ResponseError("User not found", 404);
      }
      // Only cache public fields: never the password hash or refresh token.
      data = { username: found.username, name: found.name };
      await redis.setex(key, 3600, JSON.stringify(data));
    }
    return toUserResponse(data, user);
  }

  static async update(
    user: tokenAndRefresh,
    req: updateUserRequest
  ): Promise<userResponse> {
    const data = await Validation.validate(userValidation.update, req);

    if (data.password) {
      data.password = await bcrypt.hash(data.password, 10);
    }

    const updateUser = await prismaClient.users.update({
      where: {
        username: user.username,
      },
      data,
    });

    await redis.del(cacheKey.user(user.username));

    return toUserResponse(updateUser, user);
  }

  static async logout(user: tokenAndRefresh): Promise<void> {
    await prismaClient.users.update({
      where: {
        username: user.username,
      },
      data: {
        token: null,
      },
    });
  }
}