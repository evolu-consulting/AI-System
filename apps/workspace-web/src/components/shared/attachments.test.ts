// CR-125 · cr125-run-attachments · unit: giá trị ô tệp đã gửi ⇒ danh sách id để vẽ liên kết tên tệp.
import { describe, expect, test } from "bun:test";
import { fileIdsOf } from "./attachments";

const A = "7c1d2b6e-0000-4000-8000-0000000000aa";
const B = "7c1d2b6e-0000-4000-8000-0000000000bb";

describe("fileIdsOf", () => {
  test("phiếu «Tạo yêu cầu»: 'id1, id2' ⇒ hai id; trùng gộp, chữ thường", () => {
    expect(fileIdsOf(`${A}, ${B.toUpperCase()}, ${A}`)).toEqual([A, B]);
  });
  test("bước form: id đơn", () => {
    expect(fileIdsOf(A)).toEqual([A]);
  });
  test("không có id ⇒ rỗng (trang chỉ đếm)", () => {
    expect(fileIdsOf("2 tệp")).toEqual([]);
    expect(fileIdsOf("")).toEqual([]);
  });
});
