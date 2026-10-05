// HUB-FR-12 · HUB-FR-50 · H2c-R22 · lỗi Dify `/files/upload` → mã run/tool, id upload (test-plan H2c §1, cases §1.7
// R39–R40; chữ ký plan-rules §5 `dify/dify-upload.ts`).
import { describe, expect, it } from "bun:test";
import { mapDifyHttpError } from "../../../../apps/hub-api/src/modules/dify/dify.rules";

type UploadErr = {
  code: "NOT_CONFIGURED" | "UPSTREAM_ERROR";
  reason: "file_rejected" | "upstream";
};
type DifyUpload = {
  mapDifyUploadError(status: number, body: unknown): UploadErr;
  difyUploadId(body: unknown): string | null;
};

/**
 * `dify/dify-upload.ts` chưa có stub ở B0 (báo backend-lead): nạp động theo đường dẫn plan-rules §5 để file test vẫn
 * biên dịch; vắng module → ném lỗi nêu rõ (đỏ đúng lý do "chưa hiện thực").
 */
const MODULE: string = "../../../../apps/hub-api/src/modules/dify/dify-upload";
async function upload(): Promise<DifyUpload> {
  try {
    return (await import(MODULE)) as DifyUpload;
  } catch {
    throw new Error("not implemented: dify/dify-upload.ts (stub thiếu — plan-rules §5)");
  }
}

describe("HUB-FR-12 · mapDifyUploadError [R39]", () => {
  it("HUB-FR-12 · R39 · 401/403/404 → NOT_CONFIGURED; 413/415/400 code file → file_rejected; khác → upstream [H2c-R22 · HUB-H2c-AC-09]", async () => {
    const { mapDifyUploadError } = await upload();
    for (const s of [401, 403, 404])
      expect(mapDifyUploadError(s, {})).toEqual({ code: "NOT_CONFIGURED", reason: "upstream" });
    const rejected: UploadErr = { code: "UPSTREAM_ERROR", reason: "file_rejected" };
    expect(mapDifyUploadError(413, null)).toEqual(rejected);
    expect(mapDifyUploadError(415, { code: "x" })).toEqual(rejected);
    expect(mapDifyUploadError(400, { code: "file_too_large" })).toEqual(rejected);
    expect(mapDifyUploadError(400, { code: "unsupported_file_type" })).toEqual(rejected);
    for (const [s, body] of [
      [400, { code: "invalid_param" }],
      [400, "file_too_large"],
      [500, {}],
      [503, null],
    ] as const)
      expect(mapDifyUploadError(s, body)).toEqual({
        code: mapDifyHttpError(s),
        reason: "upstream",
      });
  });
});

describe("HUB-FR-12 · difyUploadId [R40]", () => {
  it("HUB-FR-12 · R40 · body.id chuỗi 1–100 ký tự; khác → null [H2c-R22]", async () => {
    const { difyUploadId } = await upload();
    expect(difyUploadId({ id: "abc", name: "a.pdf" })).toBe("abc");
    expect(difyUploadId({ id: "x".repeat(100) })).toBe("x".repeat(100));
    for (const b of [
      { id: "" },
      { id: "x".repeat(101) },
      { id: 1 },
      {},
      null,
      "abc",
      [{ id: "a" }],
    ])
      expect(difyUploadId(b)).toBeNull();
  });
});
