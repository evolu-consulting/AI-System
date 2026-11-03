// CR-114 · hub-agent-handoff · SQL của `hub.artifacts` trong tx `withHubScope` (RLS theo tenant). Mỗi thao tác 1 câu, văn
// bản hằng; mọi câu lọc `tenant_id` tường minh ngoài RLS.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

export type NewArtifact = {
  key: string;
  kind: "text" | "json";
  body: string;
  sizeBytes: number;
  tokens: number;
  summary: string;
  runId: string | null;
  stepId: string | null;
  expiresAt: Date;
};

export type ArtifactRow = {
  key: string;
  kind: string;
  body: string;
  tokens: number;
  summary: string;
  embedded: boolean;
};

export type SearchRow = {
  key: string;
  summary: string;
  tokens: number;
  snippet: string;
  score: number;
};

/**
 * Ghi dedup: cùng (tenant, key) ⇒ không ghi lại nội dung, chỉ gia hạn `expires_at` (giữ tóm tắt cũ). Trả hàng hiện hành
 * + `embedded` để bên gọi biết có cần nhúng không.
 */
export async function upsert(tx: Tx, tid: string, a: NewArtifact): Promise<ArtifactRow> {
  const [r] = await tx.execute<ArtifactRow>(sql`insert into hub.artifacts
      (tenant_id, key, kind, body, size_bytes, tokens, summary, run_id, step_id, expires_at)
    values (${tid}::uuid, ${a.key}, ${a.kind}, ${a.body}, ${a.sizeBytes}, ${a.tokens}, ${a.summary},
      ${a.runId}::uuid, ${a.stepId}::uuid, ${a.expiresAt.toISOString()}::timestamptz)
    on conflict (tenant_id, key) do update set expires_at = greatest(hub.artifacts.expires_at, excluded.expires_at)
    returning key, kind, '' as body, tokens, summary, emb is not null as embedded`);
  if (!r) throw new Error("artifact upsert returned no row");
  // Link run ↔ artifact (dedup giữa các run: mỗi run có link riêng, `run_id` của hàng = run tạo đầu tiên).
  if (a.runId)
    await tx.execute(sql`insert into hub.artifact_runs (tenant_id, run_id, key)
      values (${tid}::uuid, ${a.runId}::uuid, ${a.key}) on conflict do nothing`);
  return { ...r, tokens: Number(r.tokens) };
}

/** Lọc theo run qua bảng nối (null ⇒ cả tenant). */
const runFilter = (tid: string, runId: string | null) =>
  sql`(${runId}::uuid is null or exists (select 1 from hub.artifact_runs l
    where l.tenant_id = ${tid}::uuid and l.run_id = ${runId}::uuid and l.key = hub.artifacts.key))`;

/** Khoá đủ hoặc tiền tố ≥ 8 hex; chưa hết hạn. Tiền tố trùng nhiều hàng ⇒ null (mơ hồ, bên gọi đưa khoá dài hơn). */
export async function byPrefix(
  tx: Tx,
  tid: string,
  prefix: string,
  runId: string | null,
): Promise<ArtifactRow | null> {
  const rows =
    await tx.execute<ArtifactRow>(sql`select key, kind, body, tokens, summary, emb is not null as embedded
    from hub.artifacts
    where tenant_id = ${tid}::uuid and key >= ${prefix} and key < ${`${prefix}g`} and expires_at > now()
      and ${runFilter(tid, runId)}
    order by key limit 2`);
  if (rows.length !== 1) return null;
  const r = rows[0] as ArtifactRow;
  return { ...r, tokens: Number(r.tokens) };
}

export async function setEmbedding(
  tx: Tx,
  tid: string,
  key: string,
  model: string,
  emb: readonly number[],
): Promise<void> {
  await tx.execute(sql`update hub.artifacts set emb = ${`{${emb.join(",")}}`}::real[], emb_model = ${model}
    where tenant_id = ${tid}::uuid and key = ${key}`);
}

/** FTS `simple` (khi không có embedding). */
export async function searchFts(
  tx: Tx,
  tid: string,
  query: string,
  k: number,
  runId: string | null,
): Promise<SearchRow[]> {
  const rows =
    await tx.execute<SearchRow>(sql`select key, summary, tokens, left(body, 200) as snippet,
      ts_rank(tsv, q) as score
    from hub.artifacts, websearch_to_tsquery('simple'::regconfig, ${query}) q
    where tenant_id = ${tid}::uuid and expires_at > now() and tsv @@ q
      and ${runFilter(tid, runId)}
    order by score desc, key limit ${k}`);
  return rows.map((r) => ({ ...r, tokens: Number(r.tokens), score: Number(r.score) }));
}

/** Tích vô hướng với vector truy vấn (cùng cách gói knowledge); chỉ artifact đã nhúng bằng cùng model. */
export async function searchVector(
  tx: Tx,
  tid: string,
  model: string,
  emb: readonly number[],
  k: number,
  runId: string | null,
): Promise<SearchRow[]> {
  const q = `{${emb.join(",")}}`;
  const rows =
    await tx.execute<SearchRow>(sql`select key, summary, tokens, left(body, 200) as snippet,
      (select sum(a * b) from unnest(emb, ${q}::real[]) as u(a, b)) as score
    from hub.artifacts
    where tenant_id = ${tid}::uuid and emb_model = ${model} and expires_at > now()
      and ${runFilter(tid, runId)}
    order by score desc nulls last, key limit ${k}`);
  return rows.map((r) => ({ ...r, tokens: Number(r.tokens), score: Number(r.score) }));
}
