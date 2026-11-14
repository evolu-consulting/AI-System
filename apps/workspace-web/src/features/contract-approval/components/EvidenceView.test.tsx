// CR-144 · EvidenceView: người duyệt (+thay), chữ ký hiện ngay bằng <img>, ảnh/PDF/loại khác.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EvidenceView } from "./EvidenceView";

const SIG = "11111111-1111-4111-8111-111111111111";
const IMG = "22222222-2222-4222-8222-222222222222";
const PDF = "33333333-3333-4333-8333-333333333333";
const ZIP = "44444444-4444-4444-8444-444444444444";
const line = {
  key: "t",
  stage: "Kế toán",
  action: "approve",
  who: "Hoa",
  onBehalf: "Lan",
  override: true,
  at: "2026-11-11T09:00:00Z",
  note: "Đã đối chiếu",
  hasEvidence: true,
  readable: true,
  signatureId: SIG,
  fileIds: [IMG, PDF, ZIP],
  files: [
    { id: SIG, name: "ky.png", mime: "image/png" },
    { id: IMG, name: "a.jpg", mime: "image/jpeg" },
    { id: PDF, name: "b.pdf", mime: "application/pdf" },
    { id: ZIP, name: "c.zip", mime: "application/zip" },
  ],
  evidenceId: "e",
} as never;

describe("EvidenceView", () => {
  test("hộp Xem hiện người duyệt và chữ ký ngay, ảnh, PDF và tệp lạ", () => {
    const out = renderToStaticMarkup(
      <EvidenceView
        line={line}
        u={{
          blobs: {
            [SIG]: new Blob(["s"], { type: "image/png" }),
            [IMG]: new Blob(["i"], { type: "image/jpeg" }),
            [PDF]: new Blob(["p"], { type: "application/pdf" }),
            [ZIP]: new Blob(["z"], { type: "application/zip" }),
          },
          failed: new Set(),
        }}
      />,
    );
    expect(out).toContain("Hoa");
    expect(out).toContain("Kế toán");
    expect(out).toContain("Đã đối chiếu");
    expect(out.match(/data-testid="fview-image"/g)?.length).toBe(2); // chữ ký + ảnh
    expect(out).not.toContain("<iframe"); // PDF dựng bằng pdf.js (nạp lười), không còn khung
    expect(out.match(/data-testid="evidence-file"/g)?.length).toBe(3); // chữ ký, ảnh, PDF
    expect(out).toContain("c.zip");
    expect(out.match(/data-testid="fview-download"/g)?.length).toBe(1); // chỉ tệp lạ có «Tải về»
    expect(out).toMatch(/<a[^>]*href="blob:[^"]*"[^>]*download="c.zip"|<a[^>]*download="c.zip"/);
  });

  test("chưa tải xong ⇒ chưa có <img>; tải lỗi ⇒ báo lỗi", () => {
    const out = renderToStaticMarkup(
      <EvidenceView line={line} u={{ blobs: {}, failed: new Set([SIG]) }} />,
    );
    expect(out).not.toContain("<img");
    expect(out).toContain('role="alert"');
  });
});
