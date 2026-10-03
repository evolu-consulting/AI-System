// ADM-FR-41 · M4-R04, R05 · Q2b · evaluator cảnh báo quota (plan M4 §5.2). Ba bước: (1) tx giữ chỗ `quota_alerts` +
// claim + đọc người nhận; (2) ngoài tx gửi mail, một mail một người; (3) tx ghi kết quả. Không bao giờ ném ra ngoài.
// Gọi từ: sau commit PUT quota, listener `quota_threshold`, GET banner/overview của tenant_admin (chạy nền).
import { type Db, withScope } from "@ai/db";
import { logger } from "../../lib/logger";
import { MailError, type Mailer } from "../../lib/mailer";
import { safeErrorFields } from "../../lib/pg-errors";
import * as alerts from "./quotas.alerts";
import * as repo from "./quotas.repo";
import { alertMail, alertsDue, evaluateQuota, monthRange } from "./quotas.rules";

export type EvaluatorCtx = {
  db: Db;
  now: () => Date;
  /** Vắng (fixture cũ) → coi như `MAIL_DISABLED`: cảnh báo giữ `pending`. */
  mailer?: Mailer;
  /** Gốc admin-web cho link `/usage`; mặc định `http://localhost:3000`. */
  webUrl?: string;
};

const DEFAULT_WEB_URL = "http://localhost:3000";
const DISABLED: Mailer = {
  async send() {
    throw new MailError("MAIL_DISABLED");
  },
};

type Work = {
  name: string;
  claimed: alerts.ClaimedAlert[];
  to: alerts.Recipient[];
};

/** Bước 1 (một tx, scope tenant): quota + usage tháng → alertsDue → giữ chỗ → claim → người nhận. */
async function prepare(ctx: EvaluatorCtx, tenantId: string): Promise<Work | null> {
  const range = monthRange(ctx.now());
  return withScope(ctx.db, { kind: "tenant", tenantId }, async (tx) => {
    const name = await alerts.tenantName(tx, tenantId);
    if (name === null) return null;
    const rows = await repo.listQuotas(tx, tenantId);
    if (rows.length > 0) {
      const usage = await repo.monthUsage(tx, tenantId, range);
      const evals = evaluateQuota({
        quotas: rows.map((r) => ({
          featureId: r.feature_id,
          maxRuns: r.max_runs,
          maxTokens: r.max_tokens,
          maxUsd: r.max_usd,
        })),
        ...usage,
      });
      const existing = await alerts.existingAlerts(tx, tenantId, range.month);
      await alerts.insertAlerts(tx, tenantId, range.month, alertsDue(evals, existing));
    }
    const claimed = await alerts.claimAlerts(tx, tenantId);
    if (claimed.length === 0) return { name, claimed, to: [] };
    const to = await alerts.recipients(tx, tenantId);
    if (to.length === 0) {
      await alerts.markSkipped(
        tx,
        tenantId,
        claimed.map((a) => a.id),
      );
      return { name, claimed: [], to };
    }
    return { name, claimed, to };
  });
}

const errCode = (err: unknown): string =>
  err instanceof MailError
    ? err.code
    : typeof (err as { code?: unknown })?.code === "string"
      ? String((err as { code: string }).code)
      : "MAIL_SEND_FAILED";

/** Bước 2: gửi từng người nhận; lỗi đầu tiên → mã lỗi của cảnh báo (vẫn thử người còn lại). */
async function sendOne(ctx: EvaluatorCtx, w: Work, a: alerts.ClaimedAlert): Promise<string | null> {
  const mailer = ctx.mailer ?? DISABLED;
  const link = `${(ctx.webUrl ?? DEFAULT_WEB_URL).replace(/\/+$/, "")}/usage`;
  let error: string | null = null;
  for (const r of w.to) {
    // Tiêu đề theo mốc (80/100), không theo pct lúc phát: "Đã dùng 80%" kể cả khi pct 85 (test AL8).
    const m = alertMail({ tenantName: w.name, pct: a.level, locale: r.locale, link });
    try {
      await mailer.send({ to: [r.email], subject: m.subject, text: m.text });
    } catch (err) {
      error ??= errCode(err);
    }
  }
  return error;
}

async function evaluate(ctx: EvaluatorCtx, tenantId: string): Promise<void> {
  const w = await prepare(ctx, tenantId);
  if (!w || w.claimed.length === 0) return;
  const results: Array<{ id: string; error: string | null }> = [];
  for (const a of w.claimed) results.push({ id: a.id, error: await sendOne(ctx, w, a) });
  await withScope(ctx.db, { kind: "tenant", tenantId }, async (tx) => {
    for (const r of results) await alerts.markResult(tx, tenantId, r.id, r.error);
  });
  const failed = results.filter((r) => r.error !== null);
  if (failed.length > 0) {
    logger.warn("quota alert mail failed", {
      module: "quotas",
      tenant_id: tenantId,
      alerts: failed.length,
      code: failed[0]?.error,
    });
  }
}

/** Không bao giờ ném ra ngoài luồng gọi (nơi gọi vẫn `.catch(log)`). */
export async function evaluateTenant(ctx: EvaluatorCtx, tenantId: string): Promise<void> {
  try {
    await evaluate(ctx, tenantId);
  } catch (err) {
    logger.error("quota evaluate failed", {
      module: "quotas",
      tenant_id: tenantId,
      ...safeErrorFields(err),
    });
  }
}

const lastRun = new WeakMap<object, Map<string, number>>();
/** Chặn lặp (plan §5.2): GET banner/overview chạy evaluator nền tối đa 1 lần / 60 s / tenant / app. */
export const THROTTLE_MS = 60_000;

export function evaluateThrottled(ctx: EvaluatorCtx, tenantId: string): void {
  let m = lastRun.get(ctx.db);
  if (!m) {
    m = new Map();
    lastRun.set(ctx.db, m);
  }
  const t = Date.now();
  const prev = m.get(tenantId);
  if (prev !== undefined && t - prev < THROTTLE_MS) return;
  m.set(tenantId, t);
  void evaluateTenant(ctx, tenantId);
}
