import { asyncHandler } from "../utils/asyncHandler.util";
import { ContactService } from "../services/contact.service";

export class ContactController {
  static create = asyncHandler(async (req, res) => {
    res.status(200).json(await ContactService.create(req.user!, req.body));
  });

  static get = asyncHandler(async (req, res) => {
    res
      .status(200)
      .json(await ContactService.get(req.user!, Number(req.params.contactId)));
  });

  static update = asyncHandler(async (req, res) => {
    req.body.id = Number(req.params.contactId);
    res.status(200).json(await ContactService.update(req.user!, req.body));
  });

  static remove = asyncHandler(async (req, res) => {
    await ContactService.remove(req.user!, Number(req.params.contactId));
    res.status(200).json({ data: "Contact deleted successfully" });
  });

  static search = asyncHandler(async (req, res) => {
    const request = {
      name: req.query.name as string,
      email: req.query.email as string,
      phone: req.query.phone as string,
      page: req.query.page ? Number(req.query.page) : 1,
      size: req.query.size ? Number(req.query.size) : 10,
    };
    res.status(200).json(await ContactService.search(req.user!, request));
  });
}