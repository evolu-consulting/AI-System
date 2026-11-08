// CR-125 · cr125-run-attachments · unit: lấy id tệp từ giá trị người dùng điền.
import { describe, expect, test } from "bun:test";
import { RUN_FILES_MAX, uuidArrayLiteral, uuidsIn } from "./run-links.rules";

const A = "7c1d2b6e-0000-4000-8000-0000000000aa";
const B = "7c1d2b6e-0000-4000-8000-0000000000bb";

describe("CR-125 · uuidsIn", () => {
  test("danh sách nối ', ' của phiếu và id đơn của ô file_ref; chữ thường, không trùng", () => {
    expect(uuidsIn([`${A}, ${B.toUpperCase()}`, A])).toEqual([A, B]);
    expect(uuidsIn([A])).toEqual([A]);
  });
  test("giá trị không phải chuỗi / không có uuid ⇒ bỏ", () => {
    expect(uuidsIn([undefined, 5, null, "Bút bi", ""])).toEqual([]);
  });
  test("trần RUN_FILES_MAX", () => {
    const many = Array.from(
      { length: RUN_FILES_MAX + 10 },
      (_, i) => `7c1d2b6e-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    expect(uuidsIn(many)).toHaveLength(RUN_FILES_MAX);
  });
  test("literal mảng Postgres", () => {
    expect(uuidArrayLiteral([A, B])).toBe(`{${A},${B}}`);
  });
});
