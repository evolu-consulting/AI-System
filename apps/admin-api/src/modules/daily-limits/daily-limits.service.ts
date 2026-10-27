// tenant-quotas · hạn mức ngày theo công ty (platform_admin): xem (riêng/env/hiệu lực/đã dùng hôm nay), sửa cả bộ, đặt lại
// hôm nay. Sửa + đặt lại token AI = `configWrite` (bump `config_version` ⇒ hub nạp lại cache tenant, audit `quota` update).
// Đặt lại lượt tải/thao tác = xoá khoá Redis của ngày hiện tại (múi tenant) + audit (không bump).
import {
  aiTokensSince,
  DAILY_LIMIT_KINDS,
  type DailyLimitItem,
  type DailyLimitKind,
  type DailyLimitsPut,
  type DailyLimitsResponse,
  dailyCounterKey,
  effectiveDailyLimit,
  envDailyLimit,
  tenantLocalDay,
} from "@ai/contracts";
import { withScope } from "@ai/db";
import { auditOf, recordAudit } from "../../lib/audit/audit.write";
import { type ConfigCall, configWrite } from "../../lib/config/config-write";
import { AppError, appError } from "../../lib/errors";
import type { DailyCounterStore } from "./daily-limits.counter";
import {
  aiTokensUsed,
  type DailyLimitsRow,
  readLimits,
  saveAiReset,
  saveLimits,
  type TenantLimits,
} from "./daily-limits.repo";

type Env = Record<string, string | undefined>;
export type DailyLimitsCall = ConfigCall & {
  now: () => Date;
  env: Env;
  counter: DailyCounterStore | null;
};

const unavailable = () =>
  new AppError("QUOTA_COUNTER_UNAVAILABLE", 503, "Quota counter unavailable");

const overrideOf = (r: DailyLimitsRow, k: DailyLimitKind): number | null =>
  k === "uploads" ? r.uploads : k === "actions" ? r.actions : r.aiTokens;

const dto = (r: DailyLimitsRow) => ({
  uploads: r.uploads,
  actions: r.actions,
  ai_tokens: r.aiTokens,
});

/** Đọc bộ đếm Redis; Redis vắng/lỗi ⇒ null (màn hình hiện "—", không chặn sửa hạn mức). */
async function counted(
  c: DailyLimitsCall,
  tenantId: string,
  day: string,
): Promise<(number | null)[]> {
  if (!c.counter) return [null, null];
  try {
    const keys = [
      dailyCounterKey("uploads", tenantId, day),
      dailyCounterKey("actions", tenantId, day),
    ];
    return await c.counter.read(keys);
  } catch {
    return [null, null];
  }
}

async function view(
  c: DailyLimitsCall,
  tenantId: string,
  t: TenantLimits,
  aiUsed: number | null,
): Promise<DailyLimitsResponse> {
  const at = c.now();
  const day = tenantLocalDay(at, t.timezone);
  const [up, act] = await counted(c, tenantId, day);
  const used: Record<DailyLimitKind, number | null> = {
    uploads: up ?? null,
    actions: act ?? null,
    ai_tokens: aiUsed,
  };
  const items: DailyLimitItem[] = DAILY_LIMIT_KINDS.map((kind) => {
    const env = envDailyLimit(kind, c.env);
    const override = overrideOf(t.row, kind);
    return {
      kind,
      override,
      env_default: env,
      effective: effectiveDailyLimit(override, env),
      used: used[kind],
      day: kind === "ai_tokens" ? at.toISOString().slice(0, 10) : day,
    };
  });
  return { tenant_id: tenantId, timezone: t.timezone, items };
}

export async function getDailyLimits(
  c: DailyLimitsCall,
  tenantId: string,
): Promise<DailyLimitsResponse> {
  const t = await withScope(c.ctx.db, c.scope, async (tx) => {
    const t = await readLimits(tx, tenantId);
    if (!t) throw appError("NOT_FOUND");
    return t;
  });
  // `hub.usage_logs` không RLS, ngoài transaction scope: bảng Hub chưa đủ cột (DB chỉ có migration Admin) ⇒ null ("—").
  const since = aiTokensSince(c.now(), t.row.aiTokensResetAt);
  const ai = await aiTokensUsed(c.ctx.db, tenantId, since).catch(() => null);
  return view(c, tenantId, t, ai);
}

export async function putDailyLimits(
  c: DailyLimitsCall,
  tenantId: string,
  input: DailyLimitsPut,
): Promise<DailyLimitsResponse> {
  await configWrite(c, "quota.save", async (tx, ch) => {
    const t = await readLimits(tx, tenantId, true);
    if (!t) throw appError("NOT_FOUND");
    const before = dto(t.row);
    if (JSON.stringify(before) === JSON.stringify(input)) return;
    await saveLimits(
      tx,
      tenantId,
      { uploads: input.uploads, actions: input.actions, aiTokens: input.ai_tokens },
      c.actor.userId,
    );
    ch.changed({ entity: "quota", tenantId });
    ch.audit(
      auditOf("update", "quota", {
        entityId: tenantId,
        entityName: "daily_limits",
        tenantId,
        before: { daily_limits: before },
        after: { daily_limits: input },
      }),
    );
  });
  return getDailyLimits(c, tenantId);
}

const resetAudit = (tenantId: string, kind: DailyLimitKind, day: string) =>
  auditOf("update", "quota", {
    entityId: tenantId,
    entityName: `daily_limits.${kind}`,
    tenantId,
    before: null,
    after: { daily_limits: { reset: kind, day } },
    summary: { reset: kind, day },
  });

/** "Đặt lại hôm nay" một loại. Lượt tải/thao tác: xoá khoá Redis ngày hiện tại (múi tenant); token AI: mốc đếm = bây giờ. */
export async function resetDailyLimit(
  c: DailyLimitsCall,
  tenantId: string,
  kind: DailyLimitKind,
): Promise<DailyLimitsResponse> {
  const at = c.now();
  if (kind === "ai_tokens") {
    await configWrite(c, "quota.save", async (tx, ch) => {
      if (!(await readLimits(tx, tenantId, true))) throw appError("NOT_FOUND");
      await saveAiReset(tx, tenantId, at, c.actor.userId);
      ch.changed({ entity: "quota", tenantId });
      ch.audit(resetAudit(tenantId, kind, at.toISOString().slice(0, 10)));
    });
    return getDailyLimits(c, tenantId);
  }
  const counter = c.counter;
  if (!counter) throw unavailable();
  await withScope(c.ctx.db, c.scope, async (tx) => {
    const t = await readLimits(tx, tenantId);
    if (!t) throw appError("NOT_FOUND");
    const day = tenantLocalDay(at, t.timezone);
    // Audit trước, DEL là bước cuối: DEL lỗi ⇒ ném ⇒ rollback audit (không ghi audit cho việc chưa xảy ra).
    await recordAudit(tx, { ...resetAudit(tenantId, kind, day), actorId: c.actor.userId });
    await counter.reset(dailyCounterKey(kind, tenantId, day)).catch(() => {
      throw unavailable();
    });
  });
  return getDailyLimits(c, tenantId);
}
