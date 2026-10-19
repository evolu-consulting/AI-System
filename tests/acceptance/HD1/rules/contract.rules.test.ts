// HD-FR-01 · HD-FR-02 · HD-FR-03 · HD-FR-04 · D-04 · plan §1: contract zod `packages/contracts/src/pack-contracts/` (T4).
// Chỉ dùng tên đã khai ở plan §1: CONTRACT_FIELD_KINDS, CONTRACT_TYPES, CONTRACT_STATUSES, HANDLED_OUTCOMES, ITEM_KINDS,
// fieldValueSchema(key), ContractFieldSchema. Không DB.
import { describe, expect, it } from "bun:test";
import { FIELD_KINDS, ITEM_KEYS, loadContractsPkg, OUTCOMES, STATUSES } from "../_support/pure";

type Schema = { safeParse: (v: unknown) => { success: boolean; data?: unknown } };
const pkg = () => loadContractsPkg();
const okOf = async (key: string, v: unknown) =>
  ((await pkg()).fieldValueSchema(key) as Schema).safeParse(v).success;

describe("HD-FR-02 · khai báo trường: đúng 23 khoá FIELD_KINDS, đúng kiểu", () => {
  it("HD-FR-02 · CONTRACT_FIELD_KINDS = đúng 23 khoá và kiểu text/enum/date/bool/int/float theo spec", async () => {
    const m = await pkg();
    expect(m.CONTRACT_FIELD_KINDS).toEqual(FIELD_KINDS);
  });
  it("HD-FR-04 · ITEM_KINDS = đúng 11 trường hàng hoá", async () => {
    const m = await pkg();
    expect(Object.keys(m.ITEM_KINDS).sort()).toEqual([...ITEM_KEYS].sort());
  });
});
describe("HD-FR-03 · HD-FR-01 · enum", () => {
  it("D-04 · CONTRACT_STATUSES = 8 trạng thái spec + 'rejected' ở CUỐI (thứ tự cố định)", async () => {
    expect([...(await pkg()).CONTRACT_STATUSES]).toEqual([...STATUSES]);
  });
  it("HD-FR-03 · HANDLED_OUTCOMES = renewed, not_renewed, negotiating, replaced", async () => {
    expect([...(await pkg()).HANDLED_OUTCOMES]).toEqual([...OUTCOMES]);
  });
  it("HD-FR-01 · CONTRACT_TYPES = purchase, service, framework, principle", async () => {
    expect([...(await pkg()).CONTRACT_TYPES]).toEqual([
      "purchase",
      "service",
      "framework",
      "principle",
    ]);
  });
});

describe("HD-AC07 · fieldValueSchema(key) — validate theo kiểu của khoá", () => {
  it("HD-AC07 · int: total_value nhận 0 và 9e15, từ chối âm, số lẻ, chuỗi 'abc'; nullable", async () => {
    expect(await okOf("total_value", 0)).toBe(true);
    expect(await okOf("total_value", 9_000_000_000_000_000)).toBe(true);
    expect(await okOf("total_value", null)).toBe(true);
    expect(await okOf("total_value", -1)).toBe(false);
    expect(await okOf("total_value", 1.5)).toBe(false);
    expect(await okOf("total_value", "abc")).toBe(false);
    expect(await okOf("total_value", 9_000_000_000_000_001)).toBe(false);
  });
  it("HD-AC07 · notice_days 0…3650: 'abc' ⇒ sai; 3651 ⇒ sai; 3650 ⇒ đúng", async () => {
    expect(await okOf("notice_days", "abc")).toBe(false);
    expect(await okOf("notice_days", 3651)).toBe(false);
    expect(await okOf("notice_days", 3650)).toBe(true);
    expect(await okOf("notice_days", -1)).toBe(false);
  });
  it("HD-FR-02 · float: vat_rate 0…100", async () => {
    expect(await okOf("vat_rate", 8.5)).toBe(true);
    expect(await okOf("vat_rate", 100.1)).toBe(false);
    expect(await okOf("vat_rate", -0.1)).toBe(false);
  });
  it("HD-FR-02 · date ISO: '2027-03-31' đúng; '31/12/2026', '2027-02-30', '2027-3-1' sai", async () => {
    expect(await okOf("end_date", "2027-03-31")).toBe(true);
    expect(await okOf("end_date", "31/12/2026")).toBe(false);
    expect(await okOf("end_date", "2027-02-30")).toBe(false);
    expect(await okOf("end_date", "2027-3-1")).toBe(false);
  });
  it("HD-FR-02 · bool: auto_renew nhận true/false, từ chối 'yes'/1", async () => {
    expect(await okOf("auto_renew", true)).toBe(true);
    expect(await okOf("auto_renew", "yes")).toBe(false);
    expect(await okOf("auto_renew", 1)).toBe(false);
  });
  it("HD-FR-02 · enum: type chỉ nhận 4 giá trị CONTRACT_TYPES (hoặc null)", async () => {
    expect(await okOf("type", "framework")).toBe(true);
    expect(await okOf("type", "lease")).toBe(false);
    expect(await okOf("type", null)).toBe(true);
  });
  it("HD-FR-02 · text: cắt khoảng trắng đầu/cuối, tối đa 2000 ký tự", async () => {
    const m = await pkg();
    const s = m.fieldValueSchema("buyer_name") as Schema;
    expect(s.safeParse("  Công ty ABC  ").data).toBe("Công ty ABC");
    expect(s.safeParse("x".repeat(2000)).success).toBe(true);
    expect(s.safeParse("x".repeat(2001)).success).toBe(false);
  });
  it("HD-FR-02 · khoá lạ ⇒ fieldValueSchema ném hoặc từ chối (không trả schema mở)", async () => {
    const m = await pkg();
    let rejected = false;
    try {
      rejected = !(m.fieldValueSchema("khong_co") as Schema).safeParse("x").success;
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });
});

describe("HD-FR-02 · ContractFieldSchema = {value, quote ≤ 2000, verified, edited}, strict", () => {
  const good = { value: "A", quote: "q", verified: true, edited: false };
  it("HD-FR-02 · hợp lệ nhận; thừa khoá bị từ chối; quote > 2000 bị từ chối", async () => {
    const s = (await pkg()).ContractFieldSchema as Schema;
    expect(s.safeParse(good).success).toBe(true);
    expect(s.safeParse({ ...good, extra: 1 }).success).toBe(false);
    expect(s.safeParse({ ...good, quote: "x".repeat(2001) }).success).toBe(false);
    expect(s.safeParse({ value: "A", quote: "q", verified: true }).success).toBe(false);
  });
});
