// HUB-FR-122 · WRK-FR-27 · PB-R05 · e2e P-b · Runtime GIẢ cho job `source.resolve` (bổ sung `PaRuntime` — stage `agent.cli` vẫn
// do `_pa-runtime.ts` lo): claim job queued type `source.resolve`, sinh job-token (43 ký tự base64url, DB chỉ giữ sha256) rồi
// `POST /internal/jobs/:id/sources-resolved` như Runtime thật. Kết quả theo `key` nguồn: `bad-*` ⇒ SOURCE_UNRESOLVABLE,
// `big-*` ⇒ SOURCE_TOO_LARGE, còn lại ok (git: sha cố định; local: snapshot_id; library: version). Không git, không internet.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type postgres from "postgres";

export const FAKE_SHA = "0123456789abcdef0123456789abcdef01234567";

type Item = {
  source_id: string;
  key: string;
  kind: "git_remote" | "local_path" | "library";
  config: { url?: string; path?: string; document_id?: string };
};
type Row = { id: string; payload: { items?: Item[] } };

function resultOf(it: Item) {
  if (it.key.startsWith("bad-"))
    return { status: "error", source_id: it.source_id, code: "SOURCE_UNRESOLVABLE" };
  if (it.key.startsWith("big-"))
    return { status: "error", source_id: it.source_id, code: "SOURCE_TOO_LARGE" };
  const pin =
    it.kind === "git_remote"
      ? { kind: "git_remote", url: it.config.url, sha: FAKE_SHA }
      : it.kind === "local_path"
        ? { kind: "local_path", path: it.config.path, snapshot_id: randomUUID() }
        : { kind: "library", document_id: it.config.document_id, version: randomUUID() };
  return { status: "ok", source_id: it.source_id, pin, files: 12, bytes: 2048 };
}

export class PbSourceRuntime {
  private busy = false;
  constructor(
    private readonly sql: postgres.Sql,
    private readonly hubUrl: string,
  ) {}

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const rows = await this.sql<Row[]>`select id, payload from hub.jobs
        where type = 'source.resolve' and status = 'queued' order by created_at, id limit 10`;
      for (const r of rows) await this.handle(r);
    } catch {
      // bảng/cột 0021 chưa có — bỏ qua (test đỏ ở expect/UI)
    } finally {
      this.busy = false;
    }
  }

  private async handle(r: Row): Promise<void> {
    const token = randomBytes(32).toString("base64url");
    const hash = createHash("sha256").update(token, "utf8").digest();
    const up = await this.sql`update hub.jobs set status = 'running', worker_id = 'e2e-pb-rt',
        started_at = now(), heartbeat_at = now(), attempts = attempts + 1, token_hash = ${hash}
      where id = ${r.id} and status = 'queued' returning id`;
    if (!up.length) return;
    const results = (r.payload.items ?? []).map(resultOf);
    const res = await fetch(`${this.hubUrl}/internal/jobs/${r.id}/sources-resolved`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ results }),
    });
    await this
      .sql`update hub.jobs set status = ${res.ok ? "succeeded" : "failed"}, finished_at = now(), pgid = null
      where id = ${r.id} and status = 'running'`;
  }
}
