// V2-J2 · ADR-0023: cổng AI + trần thao tác của gói (lớp 2 — chỉ kiểu). `lib/ai-client` (`AiClient`) và
// `adapters/action-quota.ts` cài; nối ở `*.mount.ts`.

/** Một lời gọi model qua AI client chung của Hub (trần token/tenant, ghi usage). */
export type AiCompleteRequest = {
  tenantId: string;
  userId: string | null;
  /** Khoá tính năng `goi.viec`. */
  feature: string;
  system: string;
  prompt: string;
  model: string;
  maxTokens?: number;
  signal: AbortSignal;
  /** Cho phép đúng MỘT công cụ — tìm web. */
  webSearch?: boolean;
};
export type AiCompleteResult =
  | { ok: true; text: string }
  | { ok: false; code: "CAP_EXCEEDED" | "UNAVAILABLE" | "FAILED" | "REFUSED" };
export type AiComplete = { complete(req: AiCompleteRequest): Promise<AiCompleteResult> };

/** Trần thao tác tốn AI/tenant/ngày: vượt ⇒ ném. */
export type ActionQuota = (tenantId: string) => Promise<void>;
