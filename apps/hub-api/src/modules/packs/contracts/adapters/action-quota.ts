// HD-FR-35 · #221 · D3-10: trần thao tác tốn AI theo tenant/ngày (`/extract`, `/manual`, `/approval` redo) — MỘT pipeline Redis
// `INCR` + `EXPIRE` (khoá `q:contracts:a:<tenant>:<ngày múi tenant>`). Vượt ⇒ 429 `ACTION_QUOTA {limit, resets_at}`; Redis vắng/lỗi
// ⇒ 503 `UPLOAD_QUOTA_UNAVAILABLE` (đóng an toàn như D-17). Đếm SAU khi qua kiểm thân/quyền (route gọi ngay trước use case).
import { CONTRACT_APPROVAL_ERRORS } from "@ai/contracts";
import type { Redis } from "ioredis";
import { AppError } from "../../../../lib/errors";
import type { ActionQuota } from "../application/ai.ports";
import { nextDayStart } from "../domain/quota-reset.rules";
import { uploadDay } from "../domain/upload.rules";
import { QUOTA_KEY_PREFIX, QUOTA_TTL_S } from "./upload-counter.redis";

export const ACTIONS_TENANT_DAILY = 100;

export type { ActionQuota };

export function actionQuota(o: {
  redis?: Redis;
  limit: number;
  /** tenant-quotas · hạn mức riêng của tenant (Admin); null ⇒ `limit` (env). */
  limitOf?: (tenantId: string) => Promise<number | null>;
  timeZoneOf: (tenantId: string) => Promise<string>;
  now?: () => Date;
}): ActionQuota {
  const now = o.now ?? (() => new Date());
  return async (tenantId) => {
    if (!o.redis) throw new AppError("UPLOAD_QUOTA_UNAVAILABLE", 503, "Quota counter unavailable");
    const tz = await o.timeZoneOf(tenantId);
    const limit = (o.limitOf ? await o.limitOf(tenantId) : null) ?? o.limit;
    const at = now();
    const key = `${QUOTA_KEY_PREFIX}a:${tenantId}:${uploadDay(at, tz)}`;
    let n: number;
    try {
      const out = await o.redis.pipeline().incr(key).expire(key, QUOTA_TTL_S).exec();
      if (!out || out[0]?.[0]) throw new Error("redis");
      n = Number(out[0]?.[1]);
    } catch {
      throw new AppError("UPLOAD_QUOTA_UNAVAILABLE", 503, "Quota counter unavailable");
    }
    if (n > limit)
      throw new AppError(
        "ACTION_QUOTA",
        CONTRACT_APPROVAL_ERRORS.ACTION_QUOTA,
        "Daily action limit reached",
        {
          limit,
          resets_at: nextDayStart(at, tz).toISOString(),
        },
      );
  };
}
