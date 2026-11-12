// CR-133 · nhãn thuần của «Tài liệu kèm».
import { describe, expect, test } from "bun:test";
import { errorKey, sizeLabel, sourceKey } from "./files-view";

describe("CR-133 files-view", () => {
  test("kích thước", () => {
    expect(sizeLabel(512)).toBe("512 B");
    expect(sizeLabel(2048)).toBe("2 KB");
    expect(sizeLabel(3 * 1024 * 1024)).toBe("3 MB");
    expect(sizeLabel(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });
  test("nguồn lạ ⇒ start; mã lỗi lạ ⇒ generic", () => {
    expect(sourceKey("form")).toBe("form");
    expect(sourceKey("x")).toBe("start");
    expect(errorKey("FILE_TYPE")).toBe("FILE_TYPE");
    expect(errorKey("???")).toBe("generic");
    expect(errorKey(undefined)).toBe("generic");
  });
});
