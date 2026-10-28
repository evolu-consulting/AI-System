// com-c8-host-read · khớp tên SP cho cổng đọc sổ chủ quản: id > khớp đúng khoá (bỏ dấu/hoa thường) > tiền tố ngắn nhất; không AI.
import { describe, expect, it } from "bun:test";
import { foldVi } from "./fold.rules";
import { hintKey, isUuid, pickMatch } from "./host-book.rules";

const c = (id: string, name: string) => ({ id, name, nameKey: foldVi(name) });
const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const ID3 = "33333333-3333-4333-8333-333333333333";
const cands = [c(ID1, "Xi măng PCB40 Hà Tiên"), c(ID2, "Xi măng"), c(ID3, "Xi măng PCB30")];

describe("com-c8 · pickMatch", () => {
  it("khớp đúng khoá, không phân biệt dấu/hoa thường/khoảng trắng thừa", () => {
    const m = pickMatch({ name: "  XI MANG " }, cands);
    expect(m?.product.id).toBe(ID2);
    expect(m?.how).toBe("exact");
  });
  it("không có khớp đúng ⇒ tiền tố ngắn nhất thắng", () => {
    const m = pickMatch({ name: "xi măng pcb" }, cands);
    expect(m?.product.id).toBe(ID3);
    expect(m?.how).toBe("prefix");
  });
  it("id thắng tên; id không thuộc ứng viên ⇒ null", () => {
    expect(pickMatch({ productId: ID1, name: "xi măng" }, cands)?.how).toBe("id");
    expect(pickMatch({ productId: "44444444-4444-4444-8444-444444444444" }, cands)).toBeNull();
  });
  it("tên rỗng / không khớp ⇒ null; khoá chỉ bắt đầu, không chứa giữa chuỗi", () => {
    expect(pickMatch({ name: "   " }, cands)).toBeNull();
    expect(pickMatch({ name: "pcb40" }, cands)).toBeNull();
    expect(hintKey({ name: "Đá 1x2" })).toBe("da 1x2");
  });
  it("isUuid", () => {
    expect(isUuid(ID1)).toBe(true);
    expect(isUuid("abc")).toBe(false);
  });
});
