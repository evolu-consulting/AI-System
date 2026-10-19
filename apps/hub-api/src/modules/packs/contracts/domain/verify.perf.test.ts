// HD-FR-22 · Luật 4c · HD2 plan "Thiết kế hiệu năng": kiểm cả bản trích (23 trường + 50 dòng hàng + cảnh báo) cho HĐ 30.000 ký
// tự ≤ 5 ms (p95 của 200 lượt, sau 20 lượt làm nóng). In số đo thật.
import { expect, it } from "bun:test";
import { applyExtraction, type RawExtraction } from "./extraction.rules";
import { ruleWarnings } from "./warnings.rules";

const LINE =
  "Điều 7. Bên bán giao hàng tại kho Bên mua trong vòng 07 ngày kể từ ngày nhận đơn đặt hàng hợp lệ. ";
function contract(): string {
  const rows = Array.from(
    { length: 50 },
    (_, i) => `| Hàng hoá số ${i} | cái | ${100 + i} | ${(1000 + i) * 1000} |`,
  );
  let s = `HỢP ĐỒNG MUA BÁN số 01/2026\nTừ ngày 01/01/2026 đến ngày 31/12/2026.\nTổng giá trị: 1,5 tỷ đồng.\n${rows.join("\n")}\n`;
  while (s.length < 30_000) s += LINE;
  return s.slice(0, 30_000);
}
const TEXT = contract();
const RAW: RawExtraction = {
  fields: {
    number: { value: "01/2026", quote: "HỢP ĐỒNG MUA BÁN số 01/2026" },
    start_date: { value: "2026-01-01", quote: "Từ ngày 01/01/2026" },
    end_date: { value: "2026-12-31", quote: "đến ngày 31/12/2026" },
    total_value: { value: 1_500_000_000, quote: "Tổng giá trị: 1,5 tỷ đồng" },
    delivery_terms: {
      value: "07 ngày",
      quote: "trong vòng 07 ngày kể từ ngày nhận đơn đặt hàng hợp lệ",
    },
    payment_terms: {
      value: "không có",
      quote: "câu không có trong văn bản nên phải dò hết 30.000 ký tự",
    },
  },
  items: Array.from({ length: 50 }, (_, i) => ({
    code: null,
    name: `Hàng hoá số ${i}`,
    spec: null,
    unit: "cái",
    qty: 100 + i,
    unit_price: (1000 + i) * 1000,
    vat_rate: null,
    moq: null,
    lead_time_days: null,
    valid_from: null,
    valid_to: null,
    quote: `| Hàng hoá số ${i} | cái | ${100 + i} | ${(1000 + i) * 1000} |`,
  })),
  clauses: [],
};

const once = () => {
  const out = applyExtraction({
    raw: RAW,
    source: TEXT,
    kind: "contract",
    oldFields: {},
    hasItems: false,
  });
  return ruleWarnings(out.fields, out.items ?? [], "none_own");
};

it("HD-FR-22 · Luật 4c · verify HĐ 30.000 ký tự + 50 dòng: p95 ≤ 5 ms", () => {
  expect(TEXT.length).toBe(30_000);
  for (let i = 0; i < 20; i++) once();
  const ms: number[] = [];
  for (let i = 0; i < 200; i++) {
    const t = performance.now();
    once();
    ms.push(performance.now() - t);
  }
  ms.sort((a, b) => a - b);
  const p50 = ms[99] ?? 0;
  const p95 = ms[189] ?? 0;
  console.log(
    `verify 30k: p50 ${p50.toFixed(3)} ms · p95 ${p95.toFixed(3)} ms · max ${ms[199]?.toFixed(3)} ms`,
  );
  const out = applyExtraction({
    raw: RAW,
    source: TEXT,
    kind: "contract",
    oldFields: {},
    hasItems: false,
  });
  expect(out.items?.every((x) => x.verified)).toBe(true);
  expect(out.fields.total_value.verified).toBe(true);
  expect(out.fields.payment_terms.verified).toBe(false);
  expect(p95).toBeLessThanOrEqual(5);
});
