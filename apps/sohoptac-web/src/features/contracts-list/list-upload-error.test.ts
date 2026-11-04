import { describe, expect, test } from "bun:test";
import { ApiError } from "@ai/web-kit/http";
import { uploadErrorText } from "./list-upload-error";

const t = (k: string) => k;
describe("uploadErrorText", () => {
  test("FILE_STORAGE_UNAVAILABLE ⇒ câu FileBox; lỗi khác ⇒ câu chung", () => {
    const e = new ApiError(503, "FILE_STORAGE_UNAVAILABLE" as never, "raw");
    expect(uploadErrorText(e, t)).toBe("contracts.list.fileStorageUnavailable");
    expect(uploadErrorText(new ApiError(500, "INTERNAL" as never, "x"), t)).toBe(
      "contracts.list.uploadFailed",
    );
    expect(uploadErrorText(new Error("x"), t)).toBe("contracts.list.uploadFailed");
  });
});
