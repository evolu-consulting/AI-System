// PK-NFR-02 · PK-FR-07 (không thuộc Lệnh xong, `bun run test:perf`) · ADR-0024: DOCX → Markdown — mẫu 38,5 KB p95 ≤ 300 ms; DOCX
// 20 MB ≤ 5 s và RSS tăng ≤ 256 MB; zip bomb bị chặn ≤ 1 s. PHỤ THUỘC ADR-0024 Accepted (đỏ ngay nếu chưa). Báo số thật.
import { afterAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadDocxAdapter, needAdr0024Accepted, ROOT } from "../_support/load";
import { percentile } from "../_support/n1";
import { buildZip, minimalDocx, u8 } from "../_support/zip";

type Conv = {
  toMarkdown(b: Uint8Array): Promise<{ ok: boolean; markdown?: string; code?: string }>;
  close?: () => Promise<void> | void;
};
let conv: Conv | undefined;
async function converter(): Promise<Conv> {
  needAdr0024Accepted();
  const m = await loadDocxAdapter();
  conv ??= m.createDocxConverter() as Conv;
  return conv;
}
afterAll(async () => {
  await conv?.close?.();
});
const MiB = 1024 * 1024;

describe("PK-NFR-02 · hiệu năng DOCX → Markdown", () => {
  it("PK-NFR-02 · file mẫu HD-bao-bi-Minh-Phat.docx (38,5 KB): p95 ≤ 300 ms trên 50 lượt (sau 5 lượt nóng)", async () => {
    const c = await converter();
    const bytes = new Uint8Array(
      readFileSync(join(ROOT, "reference/mgmt-app-contracts/samples/HD-bao-bi-Minh-Phat.docx")),
    );
    for (let i = 0; i < 5; i++) expect((await c.toMarkdown(bytes)).ok).toBe(true);
    const ms: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      const r = await c.toMarkdown(bytes);
      ms.push(performance.now() - t0);
      expect(r.ok).toBe(true);
    }
    const p95 = percentile(ms, 95);
    console.log(
      `PK-NFR-02 · mẫu 38,5 KB: p50=${percentile(ms, 50).toFixed(1)} p95=${p95.toFixed(1)} ms (ngưỡng 300)`,
    );
    expect(p95).toBeLessThanOrEqual(300);
  }, 60_000);
  it("PK-NFR-02 · DOCX 20 MB (document.xml thật + 19 MB media không nén được): ≤ 5 s, RSS tăng ≤ 256 MB", async () => {
    const c = await converter();
    const media = new Uint8Array(19 * MiB);
    for (let o = 0; o < media.length; o += 65536)
      crypto.getRandomValues(media.subarray(o, o + 65536)); // ngẫu nhiên ⇒ không nén
    const paras = Array.from(
      { length: 20000 },
      (_, i) => `<w:p><w:r><w:t>Điều khoản số ${i}: bên A và bên B thoả thuận.</w:t></w:r></w:p>`,
    ).join("");
    const doc = buildZip([
      {
        name: "word/document.xml",
        data: u8(
          `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras}</w:body></w:document>`,
        ),
      },
      { name: "word/media/image1.png", data: media, method: 0 },
    ]);
    expect(doc.length).toBeGreaterThan(19 * MiB);
    const rss0 = process.memoryUsage().rss;
    const t0 = performance.now();
    const r = await c.toMarkdown(doc);
    const ms = performance.now() - t0;
    const drss = (process.memoryUsage().rss - rss0) / MiB;
    console.log(
      `PK-NFR-02 · DOCX ${(doc.length / MiB).toFixed(1)} MB: ${ms.toFixed(0)} ms (ngưỡng 5000) · RSS +${drss.toFixed(0)} MB (ngưỡng 256; đo sau, không phải đỉnh)`,
    );
    expect(r.ok).toBe(true);
    expect(ms).toBeLessThanOrEqual(5000);
    expect(drss).toBeLessThanOrEqual(256);
  }, 60_000);
  it("PK-NFR-02 · zip bomb (khai báo 200 MiB; > 2.000 phần): mỗi cái bị chặn ≤ 1 s", async () => {
    const c = await converter();
    const bombs = [
      buildZip([{ name: "word/document.xml", data: u8("<w:document/>"), declaredSize: 200 * MiB }]),
      minimalDocx(
        Array.from({ length: 2500 }, (_, i) => ({
          name: `word/media/p${i}.xml`,
          data: new Uint8Array(),
          method: 0 as const,
        })),
      ),
    ];
    const res: { ms: number; code?: string }[] = [];
    for (const b of bombs) {
      const t0 = performance.now();
      const r = await c.toMarkdown(b);
      res.push({ ms: performance.now() - t0, code: r.code });
    }
    console.log(
      `PK-NFR-02 · zip bomb chặn sau ${res.map((x) => x.ms.toFixed(1)).join(" / ")} ms (ngưỡng 1000)`,
    );
    expect(res.map((x) => x.code)).toEqual(["DOCX_UNREADABLE", "DOCX_UNREADABLE"]);
    expect(res.every((x) => x.ms <= 1000)).toBe(true);
  }, 30_000);
});
