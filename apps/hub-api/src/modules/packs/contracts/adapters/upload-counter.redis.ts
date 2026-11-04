// HD-FR-08 · HD-AC10 · D-06 · D-17 · plan §5: bộ đếm tải lên trên Redis — MỘT pipeline `INCR` tenant (ngày múi tenant) + `INCR`
// toàn hệ thống (ngày UTC) + `EXPIRE` ×2 (172800 s); hoàn = một pipeline `DECR` ×2. Lỗi Redis ⇒ ném (use case ⇒ 503, đóng an toàn).
import type { Redis } from "ioredis";
import type { UploadCounter, UploadDays } from "../application/upload-contract.ports";

export const QUOTA_KEY_PREFIX = "q:contracts:";
export const QUOTA_TTL_S = 172_800;

const keysOf = (tenantId: string, d: UploadDays, prefix: string): [string, string] => [
  `${prefix}t:${tenantId}:${d.tenant}`,
  `${prefix}g:${d.global}`,
];

/** DECR từng khoá; xuống dưới 0 ⇒ đặt 0 (giữ TTL). Trả giá trị sau hoàn. */
export const REFUND_CLAMPED = `local out = {}
for i, k in ipairs(KEYS) do
  local v = redis.call('DECR', k)
  if v < 0 then redis.call('SET', k, '0', 'KEEPTTL'); v = 0 end
  out[i] = v
end
return out`;

type ExecOut = [Error | null, unknown][] | null;
function counts(out: ExecOut): { tenant: number; global: number } {
  if (!out) throw new Error("redis pipeline aborted");
  for (const [err] of out) if (err) throw err;
  return { tenant: Number(out[0]?.[1]), global: Number(out[1]?.[1]) };
}

/** `prefix`: CR-118 · bộ đếm riêng của gói khác dùng lại (vd `q:community:`); mặc định = khoá contracts. */
export function redisUploadCounter(redis: Redis, prefix = QUOTA_KEY_PREFIX): UploadCounter {
  return {
    take: async (tenantId, days) => {
      const [t, g] = keysOf(tenantId, days, prefix);
      const out = await redis
        .pipeline()
        .incr(t)
        .incr(g)
        .expire(t, QUOTA_TTL_S)
        .expire(g, QUOTA_TTL_S)
        .exec();
      return counts(out);
    },
    // tenant-quotas-fix: hoàn kẹp ≥ 0 (một EVAL) — Admin "Đặt lại hôm nay" đưa khoá về 0 trong lúc một lượt đang giữ.
    refund: async (tenantId, days) => {
      await redis.eval(REFUND_CLAMPED, 2, ...keysOf(tenantId, days, prefix));
    },
  };
}

/** Không có Redis (D-17): mọi lần lấy hạn mức đều lỗi ⇒ 503 `UPLOAD_QUOTA_UNAVAILABLE`; đọc vẫn chạy. */
export const unavailableUploadCounter: UploadCounter = {
  take: () => Promise.reject(new Error("redis not configured")),
  refund: () => Promise.resolve(),
};
