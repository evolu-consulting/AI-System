// GAP-D2 · luật thuần: liên hệ nhiều người (#24), MST/lỗi công ty (#23), cảnh báo bất thường + đường xu hướng (#27).
import { describe, expect, it } from "bun:test";
import type { RepDetailItem } from "@ai/contracts";
import { PartnerContactsPutSchema } from "@ai/contracts";
import { alertsOf, sparkOf } from "./alerts";
import { companyErrKey, normalizeTax } from "./company";
import { blankRow, draftsOf, rowsOf, wireOf } from "./contacts";

describe("thân PUT liên hệ khớp hợp đồng API", () => {
  it("không gửi null (API nhận chuỗi/vắng khoá)", () => {
    const d = draftsOf([{ ...blankRow(), name: "Hưng", phone: "028" }]);
    if (!("ok" in d)) throw new Error("draft");
    const body = { party: "tax:0101000005", contacts: wireOf(d.ok) };
    const r = PartnerContactsPutSchema.safeParse(body);
    expect(r.success).toBe(true);
    expect(r.data?.contacts[0]).toEqual({
      name: "Hưng",
      role: null,
      phone: "028",
      email: null,
      our_owner: null,
    });
  });
});

describe("liên hệ nhiều người", () => {
  it("bỏ dòng trống, cắt chữ, rỗng ⇒ null, giữ thứ tự", () => {
    const a = { ...blankRow(), name: " Lan ", phone: "0903", our_owner: "Hoa" };
    const r = draftsOf([a, blankRow(), { ...blankRow(), name: "Minh", email: "m@x.vn" }]);
    expect(r).toEqual({
      ok: [
        { name: "Lan", role: null, phone: "0903", email: null, our_owner: "Hoa" },
        { name: "Minh", role: null, phone: null, email: "m@x.vn", our_owner: null },
      ],
    });
  });
  it("dòng có chữ mà thiếu tên ⇒ lỗi; quá 20 ⇒ lỗi; nạp lại từ máy chủ", () => {
    expect(draftsOf([{ ...blankRow(), phone: "1" }])).toEqual({ err: "missing_name", at: 0 });
    const many = Array.from({ length: 21 }, () => ({ ...blankRow(), name: "x" }));
    expect(draftsOf(many)).toMatchObject({ err: "too_many" });
    expect(
      rowsOf([{ id: "i", name: "A", role: null, phone: null, email: null, our_owner: null }])[0],
    ).toMatchObject({ key: "i", name: "A", role: "" });
  });
});

describe("thêm công ty", () => {
  it("chuẩn hoá MST: 10 / 13 (chi nhánh) / 12 số; sai dạng ⇒ null", () => {
    expect(normalizeTax(" 0301.234.567 ")).toBe("0301234567");
    expect(normalizeTax("0301234567001")).toBe("0301234567-001");
    expect(normalizeTax("0301234567-001")).toBe("0301234567-001");
    expect(normalizeTax("123456789012")).toBe("123456789012");
    expect(normalizeTax("12345")).toBeNull();
    expect(normalizeTax("03012345-67")).toBeNull();
    expect(normalizeTax("abc")).toBeNull();
  });
  it("mã lỗi ⇒ khoá câu báo", () => {
    expect(companyErrKey("COMPANY_EXISTS")).toBe("exists");
    expect(companyErrKey("COMPANY_INVALID")).toBe("invalid");
    expect(companyErrKey("TAX_UNAVAILABLE")).toBe("unavailable");
    expect(companyErrKey("X")).toBe("failed");
  });
});

const ms = (at: string, late: number, fault: string | null = "partner"): RepDetailItem => ({
  source: "milestone",
  id: at + late,
  group: "goods",
  criterion: "ontime",
  at,
  score: 50,
  h: 1,
  label: "m",
  late_days: late,
  fault,
  contract_id: null,
});

describe("cảnh báo bất thường", () => {
  const TODAY = "2026-10-20";
  it("điểm tụt ≥ 10 so với tháng trước ⇒ score_drop; tụt ít ⇒ không", () => {
    const s = (a: number, b: number) => [
      { period: "2026-09", score: a },
      { period: "2026-10", score: b },
    ];
    expect(alertsOf(s(90, 78), [], TODAY)).toEqual([
      { kind: "score_drop", from: 90, to: 78, period: "2026-10" },
    ]);
    expect(alertsOf(s(90, 82), [], TODAY)).toEqual([]);
  });
  it("tỷ lệ trễ 30 ngày gần nhất tăng đột ngột so với 90 ngày trước ⇒ late_spike", () => {
    const base = [
      ms("2026-08-01", 0),
      ms("2026-08-10", 0),
      ms("2026-08-20", 0),
      ms("2026-08-25", 2),
    ];
    const recent = [
      ms("2026-10-05", 4),
      ms("2026-10-10", 6),
      ms("2026-10-15", 1),
      ms("2026-10-16", 0),
    ];
    expect(alertsOf([], [...base, ...recent], TODAY)).toEqual([
      { kind: "late_spike", recent: 75, base: 25, n: 4 },
    ]);
  });
  it("ít mốc, lỗi của mình hoặc việc ghi tay không tính ⇒ không cảnh báo", () => {
    expect(alertsOf([], [ms("2026-10-05", 4), ms("2026-10-10", 6)], TODAY)).toEqual([]);
    const ours = [1, 2, 3].map((d) => ms(`2026-10-0${d}`, 5, "ours"));
    expect(alertsOf([], ours, TODAY)).toEqual([]);
  });
});

describe("đường xu hướng", () => {
  it("cần ≥ 2 điểm; điểm cuối là điểm mới nhất", () => {
    expect(sparkOf([{ period: "2026-10", score: 80 }])).toBeNull();
    const s = sparkOf([
      { period: "2026-09", score: 70 },
      { period: "2026-10", score: 90 },
    ]);
    expect(s?.path.split(" ")).toHaveLength(2);
    expect(s?.last.x).toBeCloseTo(157);
  });
});
