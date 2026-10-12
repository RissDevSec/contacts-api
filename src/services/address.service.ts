import { addresses } from "@prisma/client";
import {
  addressRequest,
  addressResponse,
  dataAddress,
  updateAddressRequest,
} from "../models/address.model";
import { toAddressResponse } from "../utils/response.util";
import { Validation } from "../validation/validation";
import { addressValidation } from "../validation/address.validation";
import { prismaClient, redis } from "../app/database";
import { ResponseError } from "../utils/Error.util";
import { tokenAndRefresh } from "../utils/token.util";
import { cacheKey } from "../utils/cache.util";

export class AddressService {
  static async checkContact(
    user: tokenAndRefresh,
    contactId: number
  ): Promise<void> {
    const data = await prismaClient.contacts.findUnique({
      where: {
        id: contactId,
        username: user.username,
      },
    });
    if (data == null) {
      throw new ResponseError("Contact not found", 404);
    }
  }

  static async checkAddress(contactId: number, id: number): Promise<addresses> {
    const data = await prismaClient.addresses.findUnique({
      where: {
        id,
        contactId,
      },
    });

    if (data == null) {
      throw new ResponseError("Address not found", 404);
    }

    return data;
  }

  static async create(
    user: tokenAndRefresh,
    data: addressRequest
  ): Promise<addressResponse<dataAddress>> {
    data = await Validation.validate(addressValidation.create, data);
    await this.checkContact(user, data.contactId);

    const createAddress = await prismaClient.addresses.create({
      data,
    });

    await redis.del(cacheKey.addressList(user.username, data.contactId));
    return toAddressResponse(createAddress, user);
  }

  static async get(
    user: tokenAndRefresh,
    contactId: number,
    id: number
  ): Promise<addressResponse<dataAddress>> {
    const data = await Validation.validate(addressValidation.get, {
      id,
      contactId,
    });

    const getData = await redis.get(
      cacheKey.address(user.username, contactId, id)
    );
    let dataCache;
    if (getData) {
      dataCache = JSON.parse(getData);
    } else {
      await this.checkContact(user, data.contactId);
      dataCache = await this.checkAddress(data.contactId, data.id);
      await redis.setex(
        cacheKey.address(user.username, data.contactId, data.id),
        3600,
        JSON.stringify(dataCache)
      );
    }

    return toAddressResponse(dataCache, user);
  }

  static async update(
    user: tokenAndRefresh,
    data: updateAddressRequest
  ): Promise<addressResponse<dataAddress>> {
    data = await Validation.validate(addressValidation.update, data);
    await this.checkContact(user, data.contactId);
    await this.checkAddress(data.contactId, data.id);

    const updateAddress = await prismaClient.addresses.update({
      where: {
        id: data.id,
        contactId: data.contactId,
      },
      data,
    });

    await redis.del(
      cacheKey.address(user.username, data.contactId, data.id)
    );
    await redis.del(cacheKey.addressList(user.username, data.contactId));
    return toAddressResponse(updateAddress, user);
  }

  static async remove(
    user: tokenAndRefresh,
    contactId: number,
    id: number
  ): Promise<void> {
    const data = await Validation.validate(addressValidation.get, {
      id,
      contactId,
    });
    await this.checkContact(user, data.contactId);
    await this.checkAddress(data.contactId, data.id);
    await prismaClient.addresses.delete({
      where: {
        id: data.id,
        contactId: data.contactId,
      },
    });
    await redis.del(cacheKey.address(user.username, contactId, id));
    await redis.del(cacheKey.addressList(user.username, contactId));
  }

  static async list(
    user: tokenAndRefresh,
    contactId: number
  ): Promise<addressResponse<Array<dataAddress>>> {
    const id = await Validation.validate(addressValidation.list, contactId);

    const getData = await redis.get(cacheKey.addressList(user.username, id));
    let dataCache;
    if (getData) {
      dataCache = JSON.parse(getData);
    } else {
      await this.checkContact(user, id);
      dataCache = await prismaClient.addresses.findMany({
        where: {
          contactId: id,
        },
        select: {
          id: true,
          street: true,
          city: true,
          province: true,
          country: true,
          postalCode: true,
        },
      });

      await redis.setex(
        cacheKey.addressList(user.username, id),
        3600,
        JSON.stringify(dataCache)
      );
    }

    return {
      data: dataCache as Array<dataAddress>,
      newAccessToken: user.newAccessToken,
    };
  }
}