// CR-138 Q8/Q9 · nháp công ty: ảnh bìa (giữ/thay/xoá), chặn lưu khi màu tự chọn sai hoặc nhạt.
import { describe, expect, test } from "bun:test";
import { coverShown, firstIssue, settledCompany } from "./data";
import type { CompanyDraft } from "./types";

const co = (o: Partial<CompanyDraft> = {}): CompanyDraft => ({
  name: null,
  app_name: null,
  logo: null,
  accent: "indigo",
  theme: "auto",
  own_names: [],
  own_tax_ids: [],
  has_cover: false,
  ...o,
});
const IMG = "data:image/png;base64,AAAA";

describe("coverShown", () => {
  test("chưa có ảnh ⇒ null, có ảnh đã lưu ⇒ ảnh lưu, nháp thay ⇒ ảnh nháp, nháp xoá (null) ⇒ null", () => {
    expect(coverShown(co(), null)).toBeNull();
    expect(coverShown(co({ has_cover: true }), IMG)).toBe(IMG);
    expect(coverShown(co({ has_cover: true, cover: "data:image/jpeg;base64,BBBB" }), IMG)).toBe(
      "data:image/jpeg;base64,BBBB",
    );
    expect(coverShown(co({ has_cover: true, cover: null }), IMG)).toBeNull();
  });
});

describe("settledCompany (sau Lưu)", () => {
  test("ảnh mới ⇒ has_cover true và bỏ khoá cover, xoá ⇒ false, không đổi ⇒ giữ", () => {
    const a = settledCompany(co({ cover: IMG }));
    expect(a.has_cover).toBe(true);
    expect("cover" in a).toBe(false);
    expect(settledCompany(co({ has_cover: true, cover: null })).has_cover).toBe(false);
    expect(settledCompany(co({ has_cover: true })).has_cover).toBe(true);
  });
});

describe("firstIssue · màu chủ đạo", () => {
  const ch = { company: true, biz: false };
  test("màu tự chọn nhạt/sai ⇒ co.accentBad, preset và hex đạt ⇒ không lỗi, không đổi công ty ⇒ bỏ qua", () => {
    expect(firstIssue({ company: co({ accent: "#ffee00" }) }, ch)).toBe("co.accentBad");
    expect(firstIssue({ company: co({ accent: "#12" }) }, ch)).toBe("co.accentBad");
    expect(firstIssue({ company: co({ accent: "#1d4ed8" }) }, ch)).toBeNull();
    expect(firstIssue({ company: co({ accent: "slate" }) }, ch)).toBeNull();
    expect(
      firstIssue({ company: co({ accent: "#ffee00" }) }, { company: false, biz: true }),
    ).toBeNull();
  });
});
