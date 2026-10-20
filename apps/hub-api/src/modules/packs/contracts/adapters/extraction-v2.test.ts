// V2-G · HD-02/HD-08: đầu ra agent v2 (loại HĐ, trường chưa chắc, tóm tắt 5 mục, mốc) — parse strict, lời nhắc nêu đủ khoá, bản trích cũ
// vẫn hợp lệ; contract zod của "Lưu" (`ReviewSaveRequestSchema`) và gắn SP (`ItemProductRequestSchema`).
import { describe, expect, it } from "bun:test";
import {
  ExtractionOutputSchema,
  ItemProductRequestSchema,
  ReviewSaveRequestSchema,
} from "@ai/contracts";
import { buildExtractPrompt } from "../domain/extract-prompt.rules";
import { extractionSchemaText, parseExtraction } from "./extraction-agent";

const KEYS = Object.keys(ExtractionOutputSchema.shape.fields.shape);
const base = () => ({
  fields: Object.fromEntries(KEYS.map((k) => [k, { value: null, quote: "" }])),
  items: [],
  clauses: [],
});
const SUMMARY = {
  main: "Hợp đồng mua bán token.",
  deadlines: ["Giao trong 15 ngày"],
  penalties: ["Phạt 0,5%/ngày khi chậm giao"],
  bonuses: [],
  clauses: ["Điều 5: bảo hành 12 tháng"],
};
const U = "c0de0000-0000-4000-8000-000000000001";

describe("V2-G · parse đầu ra agent v2", () => {
  it("bản trích cũ (không khoá v2) ⇒ hợp lệ", () => {
    expect(parseExtraction(JSON.stringify(base()))).not.toBeNull();
  });

  it("đủ deal/unsure/summary/milestones ⇒ parse", () => {
    const out = {
      ...base(),
      deal: "referral",
      unsure: ["end_date", "deal"],
      summary: SUMMARY,
      milestones: [
        {
          kind: "pay",
          title: "Trả đợt 1",
          due_date: "2026-05-01",
          amount: 5_000_000,
          quote: "đợt 1",
        },
        { kind: "renewal", title: null, due_date: null, amount: null, quote: "" },
      ],
    };
    expect(parseExtraction(JSON.stringify(out))).toMatchObject({
      deal: "referral",
      unsure: ["end_date", "deal"],
      milestones: [{ kind: "pay" }, { kind: "renewal" }],
    });
  });
});

describe("V2-G · parse đầu ra agent v2 (từ chối)", () => {
  it.each([
    ["loại lạ", { deal: "lease" }],
    ["khoá chưa chắc lạ", { unsure: ["khong_co"] }],
    ["tóm tắt thiếu mục", { summary: { main: "x", deadlines: [] } }],
    ["tóm tắt khoá lạ", { summary: { ...SUMMARY, extra: 1 } }],
    [
      "mốc loại lạ",
      { milestones: [{ kind: "xx", title: null, due_date: null, amount: null, quote: "" }] },
    ],
    [
      "mốc ngày sai",
      { milestones: [{ kind: "pay", title: null, due_date: "mai", amount: null, quote: "" }] },
    ],
    [
      "mốc tiền âm",
      { milestones: [{ kind: "pay", title: null, due_date: null, amount: -1, quote: "" }] },
    ],
    [
      "mốc khoá lạ",
      {
        milestones: [{ kind: "pay", title: null, due_date: null, amount: null, quote: "", id: 1 }],
      },
    ],
    [
      "quá 50 mốc",
      {
        milestones: Array.from({ length: 51 }, () => ({
          kind: "other",
          title: null,
          due_date: null,
          amount: null,
          quote: "",
        })),
      },
    ],
  ])("từ chối: %s", (_n, extra) => {
    expect(parseExtraction(JSON.stringify({ ...base(), ...extra }))).toBeNull();
  });
});

describe("V2-G · parse đầu ra agent v2 (lời nhắc)", () => {
  it("lời nhắc: lệnh hệ thống nêu 4 khoá mới + schema đầu ra có chúng; văn bản vẫn là dữ liệu", () => {
    const p = buildExtractPrompt({
      text: "Nội dung",
      nonce: "abcdef012345",
      schema: extractionSchemaText(),
    });
    for (const k of ["deal", "unsure", "summary", "milestones"]) {
      expect(p.system).toContain(`${k}:`);
      expect(extractionSchemaText()).toContain(`"${k}"`);
    }
    expect(p.system).toContain("keys fields, items, clauses, deal, unsure, summary, milestones");
    expect(p.prompt).toContain("<contract_document_abcdef012345>");
  });
});

describe("V2-G · contract zod Lưu / gắn SP", () => {
  const ok = (b: unknown) => ReviewSaveRequestSchema.safeParse(b).success;
  it("Lưu: chỉ cần version; trường/mốc/dòng đúng hình", () => {
    expect(ok({ version: 1 })).toBe(true);
    expect(
      ok({
        version: 3,
        deal: "buy",
        fields: { title: "HĐ", end_date: null },
        items: [
          { id: U, name: "Token", qty: 2, unit_price: 1000, product_id: U, component_ids: [U] },
          { name: "Mới" },
        ],
        milestones: [{ kind: "pay", due_date: "2026-05-01", amount: 1 }],
      }),
    ).toBe(true);
  });
  it.each([
    ["thiếu version", { deal: "buy" }],
    ["khoá lạ ở gốc", { version: 1, tenant_id: U }],
    ["khoá trường lạ", { version: 1, fields: { khong_co: 1 } }],
    ["trường sai kiểu", { version: 1, fields: { total_value: "abc" } }],
    ["% và cố định cùng lúc", { version: 1, commission_pct: 5, commission_fixed: 1 }],
    ["% 3 số lẻ", { version: 1, commission_pct: 1.234 }],
    ["thành phần không có SP", { version: 1, items: [{ name: "x", component_ids: [U] }] }],
    ["dòng không tên", { version: 1, items: [{ name: "" }] }],
    ["dòng khoá lạ", { version: 1, items: [{ name: "x", contract_id: U }] }],
    ["mốc ngày sai", { version: 1, milestones: [{ kind: "pay", due_date: "mai" }] }],
    ["mốc loại lạ", { version: 1, milestones: [{ kind: "x", due_date: "2026-05-01" }] }],
    [
      "quá 200 mốc",
      {
        version: 1,
        milestones: Array.from({ length: 201 }, () => ({ kind: "other", due_date: "2026-05-01" })),
      },
    ],
  ])("từ chối: %s", (_n, b) => expect(ok(b)).toBe(false));

  it("gắn SP: uuid hoặc null; thành phần cần SP", () => {
    const p = (b: unknown) => ItemProductRequestSchema.safeParse(b).success;
    expect(p({ product_id: U })).toBe(true);
    expect(p({ product_id: null })).toBe(true);
    expect(p({ product_id: U, component_ids: [U] })).toBe(true);
    expect(p({ product_id: null, component_ids: [U] })).toBe(false);
    expect(p({ product_id: "x" })).toBe(false);
    expect(p({})).toBe(false);
    expect(p({ product_id: U, component_ids: [] })).toBe(false);
  });
});
