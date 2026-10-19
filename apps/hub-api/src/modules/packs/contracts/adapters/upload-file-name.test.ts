// HD-AC10 · D-09 · TECH-DEBT #233: phần tệp rỗng trên Bun 1.3.14 tới route dưới dạng Blob không có `name`
// (trước đây `cleanFileName(undefined)` ⇒ 500 "raw.split"). `fileNameOf` không tin `name` là chuỗi.
import { describe, expect, it } from "bun:test";
import { cleanFileName, fileNameOf } from "./upload.routes";

describe("fileNameOf", () => {
  it("File có tên ⇒ tên; Blob trần / name không phải chuỗi ⇒ '' (cleanFileName ⇒ 'file')", () => {
    expect(fileNameOf(new File([new Uint8Array(0)], "a.pdf"))).toBe("a.pdf");
    expect(fileNameOf(new Blob([]))).toBe("");
    expect(fileNameOf({ name: 42 } as unknown as Blob)).toBe("");
    expect(cleanFileName(fileNameOf(new Blob([])))).toBe("file");
  });
});
