import { asyncHandler } from "../utils/asyncHandler.util";
import { AddressService } from "../services/address.service";

export class AddressController {
  static create = asyncHandler(async (req, res) => {
    req.body.contactId = Number(req.params.contactId);
    res.status(200).json(await AddressService.create(req.user!, req.body));
  });

  static get = asyncHandler(async (req, res) => {
    res.status(200).json(
      await AddressService.get(
        req.user!,
        Number(req.params.contactId),
        Number(req.params.addressId)
      )
    );
  });

  static update = asyncHandler(async (req, res) => {
    req.body.contactId = Number(req.params.contactId);
    req.body.id = Number(req.params.addressId);
    res.status(200).json(await AddressService.update(req.user!, req.body));
  });

  static remove = asyncHandler(async (req, res) => {
    await AddressService.remove(
      req.user!,
      Number(req.params.contactId),
      Number(req.params.addressId)
    );
    res.status(200).json({ data: "Address deleted successfully" });
  });

  static list = asyncHandler(async (req, res) => {
    res
      .status(200)
      .json(await AddressService.list(req.user!, Number(req.params.contactId)));
  });
}