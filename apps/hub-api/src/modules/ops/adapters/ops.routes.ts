// CR-104 · ops-core · `GET /ops/status` · `POST /ops/check` · `GET|PUT /ops/settings`. Thứ tự kiểm: JWT (401, gốc
// `PROTECTED_PREFIXES`) → chỉ platform_admin (403, trước mọi parse/DB) → body (422 `OPS_SETTINGS_INVALID`). Không logic.
import {
  OPS_ERRORS,
  type OpsSettings,
  type OpsSettingsResponse,
  OpsSettingsSchema,
  type OpsStatusResponse,
} from "@ai/contracts/hub-admin";
import { Hono } from "hono";
import { requirePlatformAdmin } from "../../../lib/admin-role.middleware";
import type { AuthVars } from "../../../lib/auth.middleware";
import { AppError } from "../../../lib/errors";
import { readJson } from "../../../lib/http";
import { OPS_MANUAL_GAP_MS, type OpsRoundDeps, runChecksNow } from "../application/ops.round";
import type { OpsRepo, OpsState } from "./ops.repo";

export const OPS_PREFIX = "/ops";

const settingsBody = (s: OpsState): OpsSettingsResponse => ({
  settings: s.settings,
  updated_at: s.updated_at.toISOString(),
  updated_by: s.updated_by,
});

async function statusBody(repo: OpsRepo): Promise<OpsStatusResponse> {
  const r = await repo.status();
  return {
    checks: r.checks,
    events: r.events,
    settings: r.state.settings,
    last_round_at: r.state.last_round_at?.toISOString() ?? null,
  };
}

async function parseSettings(c: Parameters<typeof readJson>[0]): Promise<OpsSettings> {
  const raw = await readJson(c).catch(() => undefined);
  const r = OpsSettingsSchema.safeParse(raw);
  if (r.success) return r.data as OpsSettings;
  const issues = r.error.issues.map((i) => ({
    path: i.path.map((p) => (typeof p === "number" ? p : String(p))),
    code: i.code,
    message: i.message,
  }));
  throw new AppError(
    "OPS_SETTINGS_INVALID",
    OPS_ERRORS.OPS_SETTINGS_INVALID,
    "Invalid ops settings",
    {
      issues,
    },
  );
}

export function opsRoutes(d: OpsRoundDeps & { now?: () => Date }): Hono<AuthVars> {
  const now = d.now ?? (() => new Date());
  const r = new Hono<AuthVars>();
  r.use("*", requirePlatformAdmin());
  r.get("/status", async (c) => c.json(await statusBody(d.repo)));
  r.post("/check", async (c) => {
    const out = await runChecksNow(d, now());
    if (!out.ran) {
      const e = new AppError(
        "OPS_CHECK_RATE_LIMITED",
        OPS_ERRORS.OPS_CHECK_RATE_LIMITED,
        "Check was run less than a minute ago",
      );
      e.headers = { "Retry-After": String(OPS_MANUAL_GAP_MS / 1000) };
      throw e;
    }
    return c.json(await statusBody(d.repo));
  });
  r.get("/settings", async (c) => c.json(settingsBody(await d.repo.state())));
  r.put("/settings", async (c) => {
    const next = await parseSettings(c);
    return c.json(settingsBody(await d.repo.saveSettings(next, c.var.user.userId, now())));
  });
  return r;
}
