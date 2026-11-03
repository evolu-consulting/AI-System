// CR-114 · hub-agent-handoff · kho artifact theo nội dung: ghi (dedup theo sha256 trong tenant), đọc theo khoá/tiền tố có
// `range`, tìm (vector nếu có `Embedder` — cùng `openAiEmbedder` của knowledge — không thì FTS). Mọi truy cập qua
// `withHubScope(user)` của tenant người gọi ⇒ RLS chặn khác tenant. Lời gọi embedding nằm NGOÀI transaction.
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../lib/db";
import type { Embedder } from "../knowledge/application/ports";
import * as repo from "./artifact.repo";
import {
  type ArtifactRef,
  artifactKey,
  defaultSummary,
  estimateTokens,
  expiresAt,
  parseKey,
  type Range,
  shortKey,
  shouldEmbed,
  sliceRange,
} from "./artifact.rules";

export type ArtifactWho = { tenantId: string; userId: string };
/** Người đọc: `runId` có (token job) ⇒ chỉ thấy artifact của run đó; vắng/rỗng ⇒ cả tenant. */
export type ArtifactReader = ArtifactWho & { runId?: string };
const runOf = (w: ArtifactReader): string | null => w.runId || null;
export type ArtifactMeta = {
  kind?: "text" | "json";
  summary?: string;
  runId?: string | null;
  stepId?: string | null;
  ttlDays?: number;
};
export type ArtifactRead = {
  ref: ArtifactRef;
  kind: string;
  text: string;
  start: number;
  end: number;
  total: number;
};
export type ArtifactHit = { ref: string; summary: string; tokens: number; snippet: string };

export type ArtifactStoreDeps = {
  db: Db;
  embedder?: Embedder | null;
  now?: () => Date;
  log?: (msg: string, meta: Record<string, unknown>) => void;
};

/** Cổng tối thiểu mà Orchestrator / bước quy trình cần (test tiêm bản trong bộ nhớ). */
export type ArtifactSink = {
  put(who: ArtifactWho, body: string, meta?: ArtifactMeta): Promise<ArtifactRef>;
};

const userScope = (w: ArtifactWho) =>
  ({ kind: "user", tenantId: w.tenantId, userId: w.userId }) as const;

const refOf = (key: string, tokens: number, summary: string): ArtifactRef => ({
  key,
  short: shortKey(key),
  tokens,
  summary,
});

export class ArtifactStore implements ArtifactSink {
  constructor(private readonly d: ArtifactStoreDeps) {}

  async put(who: ArtifactWho, body: string, meta: ArtifactMeta = {}): Promise<ArtifactRef> {
    const key = artifactKey(body);
    const tokens = estimateTokens(body);
    const row = await withHubScope(this.d.db, userScope(who), (tx) =>
      repo.upsert(tx, who.tenantId, {
        key,
        kind: meta.kind ?? "text",
        body,
        sizeBytes: Buffer.byteLength(body, "utf8"),
        tokens,
        summary: meta.summary?.trim() || defaultSummary(body),
        runId: meta.runId ?? null,
        stepId: meta.stepId ?? null,
        expiresAt: expiresAt((this.d.now ?? (() => new Date()))(), meta.ttlDays),
      }),
    );
    if (!row.embedded && shouldEmbed(tokens)) await this.#embed(who, key, body);
    return refOf(key, row.tokens, row.summary);
  }

  /** Lỗi embedding không làm hỏng việc ghi (search rơi về FTS). */
  async #embed(who: ArtifactWho, key: string, body: string): Promise<void> {
    const e = this.d.embedder;
    if (!e) return;
    try {
      const [v] = await e.embed([body.slice(0, 24_000)]);
      if (!v) return;
      await withHubScope(this.d.db, userScope(who), (tx) =>
        repo.setEmbedding(tx, who.tenantId, key, e.model, v),
      );
    } catch {
      this.d.log?.("artifact-embed-failed", { tenant_id: who.tenantId });
    }
  }

  async get(
    who: ArtifactReader,
    rawKey: unknown,
    range?: Partial<Range>,
  ): Promise<ArtifactRead | null> {
    const prefix = parseKey(rawKey);
    if (!prefix) return null;
    const row = await withHubScope(this.d.db, userScope(who), (tx) =>
      repo.byPrefix(tx, who.tenantId, prefix, runOf(who)),
    );
    if (!row?.key.startsWith(prefix)) return null;
    const s = sliceRange(row.body, range);
    return { ref: refOf(row.key, row.tokens, row.summary), kind: row.kind, ...s };
  }

  async search(who: ArtifactReader, query: string, k = 5): Promise<ArtifactHit[]> {
    const q = query.trim();
    if (!q) return [];
    const lim = Math.min(Math.max(1, Math.trunc(k)), 20);
    const vec = await this.#queryVector(q);
    const run = runOf(who);
    const rows = await withHubScope(this.d.db, userScope(who), async (tx) => {
      const byVec =
        vec && this.d.embedder
          ? await repo.searchVector(tx, who.tenantId, this.d.embedder.model, vec, lim, run)
          : [];
      return byVec.length > 0 ? byVec : repo.searchFts(tx, who.tenantId, q, lim, run);
    });
    return rows.map((r) => ({
      ref: shortKey(r.key),
      summary: r.summary,
      tokens: r.tokens,
      snippet: r.snippet,
    }));
  }

  async #queryVector(q: string): Promise<number[] | null> {
    if (!this.d.embedder) return null;
    try {
      return (await this.d.embedder.embed([q]))[0] ?? null;
    } catch {
      return null;
    }
  }
}
