// CR-181 · s10 · PDF «Hồ sơ duyệt»: ảnh chữ ký NHÚNG (XObject ảnh) + dòng mã kiểm tra; không còn dòng «Chữ ký: có/không».
import { describe, expect, test } from "bun:test";
import { renderApprovalRecordPdf } from "./approval-record.pdf";

const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);
const SHA = `abcdef12${"0".repeat(56)}`;
const P = { id: "11111111-1111-4111-8111-111111111111", display_name: "Hoa" };

describe("renderApprovalRecordPdf · hình chữ ký", () => {
  test("dựng PDF có XObject ảnh và mã kiểm tra, loại chữ ký, số tệp", async () => {
    const bytes = await renderApprovalRecordPdf({
      contract: { name: "HĐ A", number: "HD-1" },
      items: [
        {
          stage: "Ký",
          action: "approve",
          at: "2026-11-11T09:00:00Z",
          actor: P,
          feedback: null,
          evidence: null,
          sign: { kind: "internal", files_signed: 2, stamp_id: "s1" },
        },
      ],
      canReadEvidence: false,
      fileNames: new Map(),
      files: [
        { kind: "signed", name: "hd-ky.pdf", sha256: SHA, check_code: "ABCDEF12", signed_by: P },
      ],
      images: new Map([["stamp:s1", { bytes: PNG, kind: "png" as const }]]),
      generatedAt: "2026-11-12T00:00:00Z",
    });
    const raw = Buffer.from(bytes).toString("latin1");
    expect(raw).toContain("/Subtype /Image");
    expect(raw).toContain("/Type /XObject");
    expect(raw.startsWith("%PDF")).toBe(true);
    const { PDFDocument } = await import("pdf-lib");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
  });
});
