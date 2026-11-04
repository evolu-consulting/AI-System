// dlc-engine · cổng `WorkspacePort` qua HTTP tới workspace DLC (`apps/dlc-workspace`, Bearer `DLC_WS_TOKEN`): project, ticket,
// artifact, queue, integrate (merge tuần tự + cổng test), deploy. Lời gọi dài (integrate, deploy) có hạn riêng; lỗi HTTP ⇒ ném
// (bước DLC lỗi ⇒ engine mở quyết định). Không log token.

import type {
  DeployResult,
  IntegrateResult,
  ProjectView,
  TeamMember,
  WorkspacePort,
} from "../application/ports";
import type { QueueItem, Ticket } from "../domain/dlc-prompts.rules";

export type WorkspaceConfig = { url: string; token: string };

const SHORT_MS = 60_000;
const LONG_MS = 60 * 60_000;

export class WorkspaceHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceHttpError";
  }
}

export function workspaceClient(
  cfg: WorkspaceConfig,
  fetchFn: typeof fetch = fetch,
): WorkspacePort {
  const base = cfg.url.replace(/\/+$/, "");
  async function call<T>(method: string, path: string, body?: unknown, ms = SHORT_MS): Promise<T> {
    const res = await fetchFn(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(ms),
    });
    const text = await res.text();
    if (!res.ok)
      throw new WorkspaceHttpError(
        res.status,
        `workspace ${method} ${path} → ${res.status} ${text.slice(0, 200)}`,
      );
    return (text ? JSON.parse(text) : {}) as T;
  }
  const p = (key: string) => `/projects/${encodeURIComponent(key)}`;
  return {
    async upsertProject(b) {
      const r = await call<{ project?: string }>("POST", "/projects", {
        key: b.key,
        title: b.title,
        conversation_id: b.conversationId,
        kh_project: b.key,
      });
      return r.project ?? b.key;
    },
    async ticket(id) {
      try {
        return await call<Ticket>("GET", `/tickets/${encodeURIComponent(id)}`);
      } catch (e) {
        if (e instanceof WorkspaceHttpError && e.status === 404) return null;
        throw e;
      }
    },
    async setTicket(id, b) {
      await call("PATCH", `/tickets/${encodeURIComponent(id)}`, {
        status: b.status,
        project_key: b.projectKey,
      });
    },
    async specFiles(project) {
      const r = await call<{ text?: string }>("GET", `${p(project)}/spec-files`);
      return r.text ?? "";
    },
    async putArtifact(project, name, content) {
      await call("PUT", `${p(project)}/artifacts/${encodeURIComponent(name)}`, { content });
    },
    async settings(project, b) {
      await call("PUT", `${p(project)}/settings`, {
        test_command: b.testCommand,
        stack: b.stack,
        ...(b.team && { team: b.team }),
        ...(b.deploySpec !== undefined && { deploy_spec: b.deploySpec }),
      });
    },
    async enqueue(project, items) {
      if (items.length) await call("POST", `${p(project)}/queue`, { items });
    },
    async next(project, prefix) {
      const r = await call<{ item?: QueueItem | null; busy?: boolean }>(
        "POST",
        `${p(project)}/queue/next`,
        { prefix },
        5 * 60_000,
      );
      return { item: r.item ?? null, busy: r.busy === true };
    },
    async integrate(project, taskId) {
      const r = await call<IntegrateResult & { skipped?: boolean }>(
        "POST",
        `${p(project)}/integrate`,
        { task_id: taskId },
        LONG_MS,
      );
      return { ok: r.ok === true, merged: r.merged === true, item: r.item ?? null };
    },
    async project(project) {
      const r = await call<{
        queue?: QueueItem[];
        summary?: Record<string, unknown>;
        log?: string;
        team?: TeamMember[];
        deploy?: { url?: string } | null;
      }>("GET", p(project));
      return {
        queue: r.queue ?? [],
        summary: r.summary ?? {},
        log: r.log ?? "",
        team: r.team ?? [],
        url: r.deploy?.url || null,
      } satisfies ProjectView;
    },
    async deploy(project) {
      const d = await call<{ configured?: boolean }>("GET", `${p(project)}/deploys`);
      if (!d.configured) return null;
      const r = await call<{
        sha?: string;
        ok?: boolean;
        url?: string | null;
        note?: string;
        tasks?: string[];
      }>("POST", `${p(project)}/deploy`, {}, LONG_MS);
      return {
        ok: r.ok === true,
        sha: r.sha ?? "",
        url: r.url ?? null,
        note: r.note ?? "",
        tasks: r.tasks ?? [],
      } satisfies DeployResult;
    },
  };
}
