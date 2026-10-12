import { Request, Response } from "express";
import { z } from "zod";
import { errorMiddleware } from "../../src/middlewares/error.middleware";
import { ResponseError } from "../../src/utils/Error.util";

function run(error: Error) {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  errorMiddleware(error, {} as Request, res as unknown as Response, jest.fn());
  return res;
}

describe("errorMiddleware", () => {
  it("maps a ZodError to a validation error response", () => {
    const parsed = z.object({ name: z.string() }).safeParse({});
    const res = run((parsed as { error: Error }).error!);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].errors).toMatch(/^Validation Error:/);
  });

  it("uses the status and message of a ResponseError", () => {
    const res = run(new ResponseError("Contact not found", 404));
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ errors: "Contact not found" });

    const other = run(new ResponseError("teapot", 418));
    expect(other.status).toHaveBeenCalledWith(418);
  });

  it("answers 400 for a malformed JSON body", () => {
    const error = Object.assign(new SyntaxError("Unexpected token"), { type: "entity.parse.failed" });
    const res = run(error);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ errors: "Invalid JSON body" });
  });

  it("answers 413 when the body is too large", () => {
    const error = Object.assign(new Error("too large"), { type: "entity.too.large" });
    const res = run(error);
    expect(res.status).toHaveBeenCalledWith(413);
  });

  it("hides the details of unexpected errors and logs them", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const res = run(new Error("db password is hunter2"));

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ errors: "InternalServerError" });
    expect(JSON.stringify(res.json.mock.calls)).not.toContain("hunter2");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});