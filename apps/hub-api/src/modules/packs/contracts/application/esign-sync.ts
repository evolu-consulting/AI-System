// esign-sweep2 · pha đồng bộ phong bì với nhà cung cấp trong vòng nền esign-sweep (lưới an toàn khi webhook không tới — vd prod chưa
// cấu hình DocuSign Connect). Sau phần SQL của vòng, NGOÀI tx: MỘT câu chọn ≤ `max` phong bì mở (`sent`/`delivered`) của nhà cung cấp
// KHÔNG demo, lần cập nhật/kiểm cuối cũ hơn `minMin` phút, cũ nhất trước — `FOR UPDATE SKIP LOCKED` + đánh dấu lần kiểm trong cùng câu
// (nhiều instance không gọi trùng; trạng thái không đổi thì không hỏi lại trước `minMin`). Rồi gọi đường đồng bộ ĐÃ CÓ (`syncEnvelope`
// = webhook/"làm mới") với song song ≤ `PARALLEL`; ra trạng thái cuối ⇒ hook `onStatus` của esign-flow chạy như webhook. Lỗi từng phong
// bì chỉ log tên lỗi (không thân, không PII).

export type EsignSyncClaimed = { tenantId: string; provider: string; envelopeId: string };
export type EsignSyncDeps = {
  /** MỘT câu: chọn + đánh dấu lần kiểm (`now`) các phong bì đến lượt (lọc tenant bật gói + nhà cung cấp không demo). */
  claim(o: {
    now: Date;
    minMin: number;
    max: number;
    tenants: readonly string[];
  }): Promise<EsignSyncClaimed[]>;
  /** Đường đồng bộ đã có (GET trạng thái ⇒ cập nhật hàng ⇒ bản đã ký ⇒ hook esign-flow). */
  run(tenantId: string, provider: string, envelopeId: string): Promise<unknown>;
  max: number;
  minMin: number;
};
export type EsignSyncResult = { checked: number; failed: number };

const PARALLEL = 4;
export const ESIGN_SYNC_MAX = 20;
export const ESIGN_SYNC_MIN = 15;

/** Env ⇒ giới hạn pha đồng bộ: `CONTRACTS_ESIGN_SYNC_MAX` (mặc định 20, 0 = tắt, ≤ 200), `CONTRACTS_ESIGN_SYNC_MIN` phút (mặc định 15, ≥ 1). */
export function esignSyncEnv(env: Record<string, string | undefined>): {
  max: number;
  minMin: number;
} {
  const int = (v: string | undefined) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : null);
  const max = int(env.CONTRACTS_ESIGN_SYNC_MAX);
  const min = int(env.CONTRACTS_ESIGN_SYNC_MIN);
  return {
    max: max === null ? ESIGN_SYNC_MAX : Math.min(max, 200),
    minMin: min === null || min < 1 ? ESIGN_SYNC_MIN : min,
  };
}

export async function syncEsignOnce(
  s: EsignSyncDeps,
  tenants: readonly string[],
  now: Date,
  warn?: (m: string, meta: Record<string, unknown>) => void,
): Promise<EsignSyncResult> {
  if (s.max <= 0 || tenants.length === 0) return { checked: 0, failed: 0 };
  const rows = await s.claim({ now, minMin: s.minMin, max: s.max, tenants });
  let failed = 0;
  for (let i = 0; i < rows.length; i += PARALLEL) {
    await Promise.all(
      rows.slice(i, i + PARALLEL).map((r) =>
        s.run(r.tenantId, r.provider, r.envelopeId).catch((e: unknown) => {
          failed += 1;
          warn?.("contract-esign-sync-failed", {
            tenant_id: r.tenantId,
            provider: r.provider,
            error: e instanceof Error ? e.name : "unknown",
          });
        }),
      ),
    );
  }
  return { checked: rows.length, failed };
}
