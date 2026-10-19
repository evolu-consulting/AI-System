// HD-FR-22 · Luật 4c · review HD2 Trung 1: kiểm trích dẫn ở trần văn bản 5 MB + 500 dòng hàng chạy ở Bun Worker — vòng sự kiện
// hub-api không bị chặn. Đo: thời gian một lượt (worker) và khoảng nghẽn lớn nhất của vòng sự kiện chính trong lúc đó (lấy mẫu
// bằng `setInterval` 5 ms — chỉ để ĐO, không phải cơ chế chờ). So với chạy tại chỗ cùng dữ liệu. Chỉ chạy dưới `PERF=1`.
import { afterAll, describe, expect, it } from "bun:test";
import type { RawExtraction } from "../domain/extraction.rules";
import { verifyExtraction } from "../domain/extraction.rules";
import { createExtractionVerifier } from "./extraction-verifier";

const MB5 = 5_000_000;
const LINE =
  "Điều 7. Bên bán giao hàng tại kho Bên mua trong vòng 07 ngày kể từ ngày nhận đơn đặt hàng hợp lệ. ";
function bigText(): string {
  const rows = Array.from(
    { length: 500 },
    (_, i) => `| Hàng ${i} | cái | ${100 + i} | ${(1000 + i) * 1000} |`,
  );
  const head = `HỢP ĐỒNG số 01/2026\nTổng giá trị: 1,5 tỷ đồng.\n${rows.join("\n")}\n`;
  return (head + LINE.repeat(Math.ceil((MB5 - head.length) / LINE.length))).slice(0, MB5);
}
const RAW: RawExtraction = {
  fields: {
    number: { value: "01/2026", quote: "HỢP ĐỒNG số 01/2026" },
    total_value: { value: 1_500_000_000, quote: "Tổng giá trị: 1,5 tỷ đồng" },
    payment_terms: { value: "x", quote: "câu không có trong văn bản nên phải dò hết 5 MB" },
  },
  items: Array.from({ length: 500 }, (_, i) => ({
    code: null,
    name: `Hàng ${i}`,
    spec: null,
    unit: "cái",
    qty: 100 + i,
    unit_price: (1000 + i) * 1000,
    vat_rate: null,
    moq: null,
    lead_time_days: null,
    valid_from: null,
    valid_to: null,
    // một nửa quote không có ⇒ dò hết văn bản (ca xấu nhất)
    quote: i % 2 ? `| Hàng ${i} | cái | ${100 + i} | ${(1000 + i) * 1000} |` : `không có dòng ${i}`,
  })),
  clauses: [],
};

async function maxLoopGap<T>(fn: () => Promise<T>): Promise<{ out: T; gap: number; ms: number }> {
  let last = performance.now();
  let gap = 0;
  const t = setInterval(() => {
    const n = performance.now();
    gap = Math.max(gap, n - last);
    last = n;
  }, 5);
  const t0 = performance.now();
  try {
    const out = await fn();
    return { out, gap: Math.max(gap, performance.now() - last), ms: performance.now() - t0 };
  } finally {
    clearInterval(t);
  }
}

describe.if(process.env.PERF === "1")("HD-FR-22 · perf verify 5 MB (Worker)", () => {
  const v = createExtractionVerifier();
  afterAll(() => v.close());
  it("5 MB + 500 dòng: Worker không chặn vòng sự kiện (nghẽn ≤ 50 ms), một lượt ≤ 5 s; tại chỗ chặn cả lượt", async () => {
    const text = bigText();
    expect(text.length).toBe(MB5);
    await v.verify({ raw: RAW, source: text, kind: "contract" }); // làm nóng (dựng worker)
    const w = await maxLoopGap(() => v.verify({ raw: RAW, source: text, kind: "contract" }));
    const inline = await maxLoopGap(async () =>
      verifyExtraction({ raw: RAW, source: text, kind: "contract" }),
    );
    console.log(
      `verify 5MB/500: worker ${w.ms.toFixed(0)} ms (nghẽn vòng sự kiện ${w.gap.toFixed(1)} ms) · tại chỗ ${inline.ms.toFixed(0)} ms (nghẽn ${inline.gap.toFixed(0)} ms)`,
    );
    expect(w.out.items.filter((i) => i.verified)).toHaveLength(250);
    expect(w.out.fields.total_value.verified).toBe(true);
    expect(w.gap).toBeLessThanOrEqual(50);
    expect(w.ms).toBeLessThanOrEqual(5_000);
  }, 60_000);
});
