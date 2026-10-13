// HUB-FR-131 · HUB-BR-37 · HUB-BR-40 · K1-AC01 · CR-073 · spec K1 §3.0, §3.2 `POST C/:id/check` · plan §3.1 (6 bước), §4, §11
// G6–G8 · "Kiểm tra" kết nối: đọc hàng (PK, nhớ `version`) NGOÀI transaction → các bước tới khi `khCheckShouldContinue` false
// (mỗi lời gọi hạn `timeoutMs` ∧ hạn tổng 20 s) → `evaluateKhCheck` → transaction ngắn lưu `check_*` WHERE version + audit
// `check {status, codes}`. Không tăng version, không bump cấu hình. KH lỗi vẫn trả 200. Khoá chỉ sống trong `KhClient.hit`.
import type { KhCheckResult } from "@ai/contracts/hub-admin";
import { withHubScope } from "@ai/db/hub-scope";
import type { KhConfig } from "../../config/env";
import type { AuthUser } from "../../lib/auth.middleware";
import type { Db } from "../../lib/db";
import { appError } from "../../lib/errors";
import type { HubAuditWriter } from "../../lib/hub-audit";
import { isSecretUseError } from "../secrets/secrets.use";
import { evaluateKhCheck, type KhProbe, khCheckShouldContinue } from "./kh.check.rules";
import type { KhClient, KhConn } from "./kh.client";
import * as repo from "./kh.repo";
import { khUrlPolicy } from "./kh.rules";

/** Hạn tổng một lần "Kiểm tra" (plan §3.1). */
export const KH_CHECK_DEADLINE_MS = 20_000;

export type KhCheckDeps = {
  db: Db;
  audit: HubAuditWriter;
  client: Pick<KhClient, "hit">;
  cfg: KhConfig;
  dev: boolean;
  now?: () => Date;
};

type Probe = Partial<KhProbe>;
type Step = (conn: KhConn, p: Probe, signal: AbortSignal) => Promise<void>;

/** Bước 4 + 5: đọc khoá (`useSecret` trong `hit`) rồi `GET /version` có khoá; không đọc được khoá ⇒ `unreadable`. */
async function versionWithKey(
  client: KhCheckDeps["client"],
  conn: KhConn,
  p: Probe,
  signal: AbortSignal,
): Promise<void> {
  try {
    const h = await client.hit(conn, "GET", "/version", { signal });
    p.key = "ok";
    p.versionWithKey = h;
  } catch (e) {
    if (!isSecretUseError(e)) throw e;
    p.key = "unreadable";
  }
}

function steps(client: KhCheckDeps["client"]): Step[] {
  return [
    async (c, p, signal) => {
      p.health = await client.hit(c, "GET", "/health", { key: false, signal });
    },
    async (c, p, signal) => {
      p.versionNoKey = await client.hit(c, "GET", "/version", { key: false, signal });
    },
    (c, p, signal) => versionWithKey(client, c, p, signal),
    async (c, p, signal) => {
      p.projects = await client.hit(c, "GET", "/projects", { signal });
    },
  ];
}

const fill = (p: Probe): KhProbe => ({
  url: p.url ?? { ok: false, reason: "invalid" },
  health: p.health ?? null,
  versionNoKey: p.versionNoKey ?? null,
  key: p.key ?? null,
  versionWithKey: p.versionWithKey ?? null,
  projects: p.projects ?? null,
  summaryProject: p.summaryProject ?? null,
});

export class KhCheckService {
  constructor(private readonly d: KhCheckDeps) {}

  /** Chạy 6 bước trên một kết nối (thuần I/O KH, không DB). */
  async probe(conn: KhConn, summaryProject: string | null): Promise<KhCheckResult> {
    const p: Probe = { summaryProject };
    p.url = khUrlPolicy(conn.baseUrl, this.d.cfg.allowedOrigins, { dev: this.d.dev });
    const signal = AbortSignal.timeout(KH_CHECK_DEADLINE_MS);
    for (const step of steps(this.d.client)) {
      if (!khCheckShouldContinue(p)) break;
      await step(conn, p, signal);
    }
    return evaluateKhCheck(fill(p), (this.d.now?.() ?? new Date()).toISOString());
  }

  async check(u: AuthUser, id: string): Promise<KhCheckResult> {
    const row = await withHubScope(this.d.db, { kind: "system" }, (tx) => repo.readConn(tx, id));
    if (!row) throw appError("NOT_FOUND");
    const conn = { id: row.id, baseUrl: row.baseUrl, secretId: row.secretId, version: row.version };
    const result = await this.probe(conn, row.summaryProject);
    await this.#save(u, row, result);
    return result;
  }

  /** Hàng đã đổi version / bị xoá trong lúc kiểm ⇒ không lưu, không audit (vẫn 200). G8 · `codes` giữ thứ tự items. */
  async #save(u: AuthUser, row: repo.KhConnRow, result: KhCheckResult): Promise<void> {
    await withHubScope(this.d.db, { kind: "system" }, async (tx) => {
      const n = await repo.saveCheck(tx, { id: row.id, version: row.version, result });
      if (n === 0) return;
      await this.d.audit.insert(tx, {
        tenantId: null,
        actorId: u.userId,
        actorUsername: await repo.usernameOf(tx, u.userId),
        actorRole: u.role,
        action: "check",
        entity: "kh_connection",
        entityId: row.id,
        entityName: row.name,
        hubConfigVersion: null,
        before: null,
        after: null,
        summary: { status: result.status, codes: result.items.map((i) => i.code) },
      });
    });
  }
}
