// HUB-FR-66 · HUB-FR-67 · spec H4b2 §3 A–B · plan H4b2 §2.1, D11 — luật thuần Models Studio: base URL, hình dạng provider
// theo loại, tham chiếu secret, provider readonly (`dify`), chặn xoá, bước profile, toàn subscription, trường đổi.
import type { Ref } from "@ai/contracts/studio";

export type Env = { dev: boolean };
export type ShapeProblem = {
  path: "secret_id" | "base_url";
  reason: "required" | "forbidden" | "invalid" | "not_https";
};
export type ProfileStepLike = { provider_key: string; model: string | null; on: readonly string[] };
export type ProviderEditable = {
  base_url: string | null;
  secret_id: string | null;
  max_concurrency: number;
  enabled: boolean;
};

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** null = hợp lệ. https không userinfo/?/#; http chỉ dev + host loopback; null luôn hợp lệ. */
export function baseUrlProblem(raw: string | null, env: Env): "invalid" | "not_https" | null {
  if (raw === null) return null;
  const u = parseUrl(raw);
  if (!u || u.hostname === "" || (u.protocol !== "https:" && u.protocol !== "http:"))
    return "invalid";
  if (u.username || u.password || u.search || u.hash || raw.includes("?") || raw.includes("#"))
    return "invalid";
  if (u.protocol === "https:") return null;
  return env.dev && LOOPBACK.has(u.hostname) ? null : "not_https";
}

/** api ⇒ secret_id bắt buộc; subscription ⇒ secret_id = null và base_url = null; rồi `baseUrlProblem`. */
export function providerShapeProblem(
  p: { kind: "api" | "subscription"; base_url: string | null; secret_id: string | null },
  env: Env,
): ShapeProblem | null {
  if (p.kind === "api" && p.secret_id === null) return { path: "secret_id", reason: "required" };
  if (p.kind === "subscription") {
    if (p.secret_id !== null) return { path: "secret_id", reason: "forbidden" };
    if (p.base_url !== null) return { path: "base_url", reason: "forbidden" };
  }
  const b = baseUrlProblem(p.base_url, env);
  return b === null ? null : { path: "base_url", reason: b };
}

/** Secret tham chiếu: không có ⇒ not_found; kind ≠ provider_api_key hoặc có tenant ⇒ wrong_kind. */
export function secretRefProblem(
  row: { kind: string; tenantId: string | null } | undefined,
): "not_found" | "wrong_kind" | null {
  if (!row) return "not_found";
  return row.kind === "provider_api_key" && row.tenantId === null ? null : "wrong_kind";
}

export const isReadonlyProvider = (vendor: string): boolean => vendor === "dify";

/** Thứ tự: readonly ⇒ PROVIDER_READONLY; còn profile ⇒ PROVIDER_IN_USE; đã có job ⇒ PROVIDER_HAS_HISTORY. */
export function providerDeleteBlock(p: {
  vendor: string;
  profiles: readonly Ref[];
  hasJobs: boolean;
}): "PROVIDER_READONLY" | "PROVIDER_IN_USE" | "PROVIDER_HAS_HISTORY" | null {
  if (isReadonlyProvider(p.vendor)) return "PROVIDER_READONLY";
  if (p.profiles.length > 0) return "PROVIDER_IN_USE";
  return p.hasJobs ? "PROVIDER_HAS_HISTORY" : null;
}

/** Lỗi đầu tiên theo thứ tự bước: provider vắng ⇒ not_found; readonly; trùng (provider, model) hoặc `on` trùng ⇒ duplicate. */
export function stepsProblem(
  steps: readonly ProfileStepLike[],
  providers: ReadonlyMap<string, { vendor: string }>,
): { index: number; reason: "not_found" | "readonly" | "duplicate" } | null {
  const seen = new Set<string>();
  for (const [index, s] of steps.entries()) {
    const p = providers.get(s.provider_key);
    if (!p) return { index, reason: "not_found" };
    if (isReadonlyProvider(p.vendor)) return { index, reason: "readonly" };
    const pair = JSON.stringify([s.provider_key, s.model]);
    if (seen.has(pair) || new Set(s.on).size !== s.on.length) return { index, reason: "duplicate" };
    seen.add(pair);
  }
  return null;
}

/** Mọi bước là `subscription` (provider không có ⇒ không tính là subscription). */
export function allSubscription(
  steps: readonly ProfileStepLike[],
  kindOf: (key: string) => string | undefined,
): boolean {
  return steps.every((s) => kindOf(s.provider_key) === "subscription");
}

const EDITABLE = ["base_url", "secret_id", "max_concurrency", "enabled"] as const;

/** Trường sửa được đã đổi (audit before/after + "không đổi ⇒ không bump"). */
export function providerChanged(
  before: ProviderEditable,
  after: ProviderEditable,
): (keyof ProviderEditable)[] {
  return EDITABLE.filter((k) => before[k] !== after[k]);
}
