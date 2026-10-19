// N5-FR-05 · lỗi dừng cả lần chạy (exit 1, không ghi gì): file sai cấu trúc, actor không phải platform admin, gói chưa cài.
export type AbortCode = "BAD_FILE" | "ACTOR_INVALID" | "PACK_NOT_INSTALLED";

export class ImportAbort extends Error {
  constructor(readonly code: AbortCode) {
    super(code);
    this.name = "ImportAbort";
  }
}
