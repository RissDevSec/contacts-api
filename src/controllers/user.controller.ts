import { asyncHandler } from "../utils/asyncHandler.util";
import { UserService } from "../services/user.service";

export class UserController {
  static register = asyncHandler(async (req, res) => {
    res.status(200).json(await UserService.register(req.body));
  });

  static login = asyncHandler(async (req, res) => {
    const { refreshToken, ...body } = await UserService.login(req.body);
    res
      .status(200)
      .cookie("refreshToken", refreshToken!, {
        httpOnly: true,
        sameSite: "strict",
        signed: true,
      })
      .json(body);
  });

  static get = asyncHandler(async (req, res) => {
    res.status(200).json(await UserService.get(req.user!));
  });

  static update = asyncHandler(async (req, res) => {
    res.status(200).json(await UserService.update(req.user!, req.body));
  });

  static logout = asyncHandler(async (req, res) => {
    await UserService.logout(req.user!);
    res.status(200).json({ data: "logout success" });
  });
}