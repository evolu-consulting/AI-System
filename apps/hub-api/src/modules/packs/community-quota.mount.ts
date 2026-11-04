// CR-118 · cr118-files-quota · lớp 4 (chỗ được nối hai gói, như `community-wire.mount.ts`): cổng `CommunityUploadGate` cho
// `POST /pack/community/files`, dùng lại bộ đếm/luật quota tải lên của contracts (`redisUploadCounter` + `takeQuota` +
// `uploadDay`) trên khoá RIÊNG `q:community:` (tệp bài không ăn vào lượt tải hợp đồng). Trần tenant/ngày = hạn mức Admin
// `dailyLimits.uploads` (cùng con số với contracts) ∨ env `COMMUNITY_UPLOADS_TENANT_DAY`; toàn hệ thống = env
// `COMMUNITY_UPLOADS_GLOBAL_DAY`; theo người/phút = env `COMMUNITY_UPLOADS_USER_MIN` (Redis cửa sổ một phút, như
// `link-check-limit.redis.ts`). Redis vắng/lỗi ⇒ 503 (đóng an toàn, D-17).
import { CONTRACT_UPLOAD_GLOBAL_DAILY, CONTRACT_UPLOAD_TENANT_DAILY } from "@ai/contracts";
import type { Redis } from "ioredis";
import { AppError } from "../../lib/errors";
import type { CommunityUploadGate } from "./community/application/pack-ports";
import {
  redisUploadCounter,
  unavailableUploadCounter,
} from "./contracts/adapters/upload-counter.redis";
import { UploadError } from "./contracts/application/upload-contract.ports";
import { takeQuota } from "./contracts/application/upload-contract.usecase";
import { uploadDay } from "./contracts/domain/upload.rules";
import { envInt } from "./packs.tenant-config";

export const COMMUNITY_QUOTA_PREFIX = "q:community:";
export const COMMUNITY_UPLOADS_USER_MIN = 10;

const unavailable = () => new AppError("UPLOAD_QUOTA_UNAVAILABLE", 503, "Upload quota unavailable");
const exceeded = (details: unknown) =>
  new AppError("UPLOAD_QUOTA", 429, "Upload quota exceeded", details);

export type CommunityGateDeps = {
  redis?: Redis | undefined;
  timeZoneOf: (tenantId: string) => Promise<string>;
  /** Hạn mức lượt tải/ngày riêng của tenant (Admin); null ⇒ env. */
  tenantLimitOf?: (tenantId: string) => Promise<number | null>;
  limits?: { tenant: number; global: number; userPerMinute: number };
  now?: () => Date;
};

/** Cửa sổ cố định một phút theo người: MỘT pipeline `INCR` + `EXPIRE`. Vượt ⇒ 429 scope `user` (không hoàn — chống dội). */
async function userRate(
  redis: Redis | undefined,
  who: { tenantId: string; userId: string },
  limit: number,
  at: Date,
) {
  if (!redis) throw unavailable();
  const minute = Math.floor(at.getTime() / 60_000);
  const key = `${COMMUNITY_QUOTA_PREFIX}u:${who.tenantId}:${who.userId}:${minute}`;
  let n: number;
  try {
    const out = await redis.pipeline().incr(key).expire(key, 120).exec();
    if (!out || out[0]?.[0]) throw new Error("redis");
    n = Number(out[0]?.[1]);
  } catch {
    throw unavailable();
  }
  if (n > limit)
    throw exceeded({
      scope: "user",
      limit,
      resets_at: new Date((minute + 1) * 60_000).toISOString(),
    });
}

export function communityUploadGate(d: CommunityGateDeps): CommunityUploadGate {
  const now = d.now ?? (() => new Date());
  const counter = d.redis
    ? redisUploadCounter(d.redis, COMMUNITY_QUOTA_PREFIX)
    : unavailableUploadCounter;
  const l = d.limits ?? {
    tenant: envInt("COMMUNITY_UPLOADS_TENANT_DAY", CONTRACT_UPLOAD_TENANT_DAILY),
    global: envInt("COMMUNITY_UPLOADS_GLOBAL_DAY", CONTRACT_UPLOAD_GLOBAL_DAILY),
    userPerMinute: envInt("COMMUNITY_UPLOADS_USER_MIN", COMMUNITY_UPLOADS_USER_MIN),
  };
  const q = {
    counter,
    limits: { tenant: l.tenant, global: l.global },
    ...(d.tenantLimitOf ? { tenantLimitOf: d.tenantLimitOf } : {}),
  };
  return async (who) => {
    const at = now();
    await userRate(d.redis, who, l.userPerMinute, at);
    const timeZone = await d.timeZoneOf(who.tenantId);
    const days = { tenant: uploadDay(at, timeZone), global: uploadDay(at, "UTC") };
    try {
      await takeQuota(q, { who, timeZone }, days, at);
    } catch (e) {
      if (!(e instanceof UploadError)) throw e;
      throw e.code === "UPLOAD_QUOTA" ? exceeded(e.details) : unavailable();
    }
    return async () => {
      await counter.refund(who.tenantId, days).catch(() => undefined);
    };
  };
}
