// ADM-FR-54 · M4-R14 · kiểm file import ở client.
import { describe, expect, test } from "bun:test";
import { checkImportFile, formatFileSize } from "./import-file";

describe("ADM-FR-54 checkImportFile", () => {
  test("nhận .yaml/.yml (không phân biệt hoa thường) tới đúng 1 MiB", () => {
    expect(checkImportFile({ name: "config-v39.yaml", size: 10 })).toBeNull();
    expect(checkImportFile({ name: "A.YML", size: 1_048_576 })).toBeNull();
  });
  test("đuôi khác → wrongType (kể cả khi quá lớn)", () => {
    expect(checkImportFile({ name: "x.json", size: 2 })).toBe("wrongType");
    expect(checkImportFile({ name: "yaml", size: 2 })).toBe("wrongType");
    expect(checkImportFile({ name: "x.yaml.txt", size: 9_999_999 })).toBe("wrongType");
  });
  test("1 048 577 byte → tooLarge", () => {
    expect(checkImportFile({ name: "big.yaml", size: 1_048_577 })).toBe("tooLarge");
  });
});

describe("ADM-FR-54 formatFileSize", () => {
  test("B / KB / MB theo locale", () => {
    expect(formatFileSize(812, "vi")).toBe("812 B");
    expect(formatFileSize(4300, "en")).toBe("4.2 KB");
    expect(formatFileSize(1_048_576, "vi")).toBe("1,0 MB");
  });
});
