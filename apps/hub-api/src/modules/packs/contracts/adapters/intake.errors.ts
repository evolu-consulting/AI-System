// CR-122 · p19-tool-reason · lỗi tool của khe `contracts.intake` ⇒ MÃ MÁY trên stage (thẻ HĐ nói rõ vì sao dừng): lỗi nghiệp vụ
// (ESignFail trừ `ESIGN_PROVIDER` tạm thời; `Error("NO_PARTNER_EMAIL")`, `ESIGN_NODE_NO_SIGNER`, `ESIGN_NODE_CONFIG_INVALID:…`…) đổi
// thành `PackToolBusinessError(mã)` ⇒ engine không thử lại ~10' vô ích mà mở quyết định ngay, `last_error_code` = mã.
// Lỗi lạ (mạng, DB) giữ nguyên ⇒ `UPSTREAM_ERROR` (thử lại). Không đưa nội dung HĐ vào mã.
import { type PackToolArgs, PackToolBusinessError, type PackToolCtx } from "../../kit/public";
import { ESignFail } from "../application/esign.helpers";

const TOKEN = /^([A-Z][A-Z0-9_]{1,63})(?::|$)/;
const TRANSIENT = new Set(["ESIGN_PROVIDER"]);

/** Mã nghiệp vụ của lỗi ném từ tool; `null` ⇒ không phải lỗi nghiệp vụ (giữ nguyên lỗi). */
export function businessCodeOf(err: unknown): string | null {
  if (err instanceof PackToolBusinessError) return null;
  if (err instanceof ESignFail) return TRANSIENT.has(err.code) ? null : err.code;
  if (err instanceof Error) return TOKEN.exec(err.message)?.[1] ?? null;
  return null;
}

/** Bọc `run` của tool: lỗi nghiệp vụ ⇒ `PackToolBusinessError` mang mã. */
export function withBusinessCodes<A extends PackToolArgs, C extends PackToolCtx, T>(
  run: (ctx: C, args: A) => Promise<T>,
): (ctx: C, args: A) => Promise<T> {
  return async (ctx, args) => {
    try {
      return await run(ctx, args);
    } catch (err) {
      const code = businessCodeOf(err);
      if (code === null) throw err;
      throw new PackToolBusinessError(err instanceof Error ? err.message : code, code);
    }
  };
}
