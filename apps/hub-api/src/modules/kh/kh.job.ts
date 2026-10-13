// HUB-FR-132 · Q10 · Q31 · CR-073 · plan K1 §3.4 bước 1, D5, D6, D10 · KH của job stage lúc tạo job (ngoài tx tạo job): kết nối
// agent tick ∩ dùng được (`check_status=ok` ∧ `khUrlPolicy`) theo thứ tự, ≤ 5 ⇒ project mỗi KH qua `KhProjectsCache` (lỗi ⇒
// `check_result.projects`) ⇒ bỏ KH rỗng. Kết quả (`KhJobItem[]`, không khoá) đi vào `kh_jobs` cùng tx INSERT job
// (`runner.repo.enqueueJob`). Lỗi bất kỳ ⇒ warn, job không có `kh-query`.
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../lib/db";
import { safeErrorFields } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import {
  type KhAgentConn,
  type KhJobItem,
  khJobConnections,
  khJobProjects,
  khToolAllowed,
} from "./kh.agent.rules";
import type { KhRuntime } from "./kh.mount";
import { type AgentKhRow, agentKhConns } from "./kh.repo";
import { khConnectionUsable, khUrlPolicy } from "./kh.rules";

/** D10 · dòng gợi ý thêm vào prompt job khi có `kh-query`. */
export const KH_QUERY_HINT =
  "You may call kh-query (≤ 5 times) for reference data from KnowledgeHub.";

export type KhJobInput = { agentId: string; runtime: string; stageJob: boolean; runId: string };
/** Seam cho `JobAgentRunner` (vắng ⇒ không KH). */
export type KhJobPreparer = (i: KhJobInput) => Promise<KhJobItem[]>;

export type KhJobDeps = { db: Db; rt: KhRuntime; log: Pick<Logger, "warn"> };

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

function usable(rt: KhRuntime, r: AgentKhRow): boolean {
  if (!khConnectionUsable(r)) return false;
  return khUrlPolicy(r.baseUrl, rt.cfg.allowedOrigins, { dev: rt.dev }).ok;
}

async function itemOf(d: KhJobDeps, r: AgentKhRow): Promise<KhJobItem> {
  const conn = { id: r.id, baseUrl: r.baseUrl, secretId: r.secretId, version: r.version };
  const fresh = await d.rt.projects.get(conn).catch((err: unknown) => {
    d.log.warn("kh-projects-fallback", { connection_id: r.id, ...safeErrorFields(err) });
    return null;
  });
  return {
    connection_id: r.id,
    name: r.name,
    summary_project: r.summaryProject,
    projects: khJobProjects(fresh, strings(r.checkProjects), r.summaryProject),
  };
}

async function prepare(d: KhJobDeps, i: KhJobInput): Promise<KhJobItem[]> {
  if (!khToolAllowed({ stageJob: i.stageJob, runtime: i.runtime, itemCount: 1 })) return [];
  const rows = await withHubScope(d.db, { kind: "system" }, (tx) => agentKhConns(tx, i.agentId));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const attached: KhAgentConn[] = rows.map((r) => ({
    connectionId: r.id,
    name: r.name,
    position: r.position,
    summaryProject: r.summaryProject,
    usable: usable(d.rt, r),
  }));
  const picked = khJobConnections(attached).flatMap((c) => byId.get(c.connectionId) ?? []);
  const items = (await Promise.all(picked.map((r) => itemOf(d, r)))).filter(
    (it) => it.projects.length > 0,
  );
  const ok = khToolAllowed({ stageJob: i.stageJob, runtime: i.runtime, itemCount: items.length });
  return ok ? items : [];
}

/** plan §3.4 bước 1 · `khPrepareJob`; không bao giờ ném (lỗi ⇒ `[]` + warn). */
export function khPrepareJob(d: KhJobDeps): KhJobPreparer {
  return async (i) => {
    try {
      return await prepare(d, i);
    } catch (err) {
      d.log.warn("kh-job-prepare-failed", { run_id: i.runId, ...safeErrorFields(err) });
      return [];
    }
  };
}
