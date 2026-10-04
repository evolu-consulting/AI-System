// HUB-FR-60, HUB-FR-61, HUB-FR-62 · H1-R16 · hàm thuần: parse + gộp yaml seed, kiểm tham chiếu, lọc `dev_only`, chọn profile
// (plan H1 §3.6). Không I/O — `seed.ts` đọc file và ghi DB.
import type { z } from "zod";
import {
  SEED_PROFILE_TOKEN,
  type SeedAgent,
  type SeedEntitlement,
  SeedFileSchema,
  type SeedGrant,
  type SeedOrchestrator,
  type SeedProfile,
  type SeedProvider,
} from "./seed.schema";

export type SeedIssue = { path: string; message: string; value?: unknown };

/** Lỗi validate seed: `message` và `issues` nêu file, đường dẫn trường và giá trị sai (A43). */
export class SeedValidationError extends Error {
  readonly issues: SeedIssue[];
  constructor(issues: SeedIssue[]) {
    super(`seed yaml không hợp lệ: ${issues.map(formatIssue).join("; ")}`);
    this.name = "SeedValidationError";
    this.issues = issues;
  }
}

function formatIssue(i: SeedIssue): string {
  const v = i.value === undefined ? "" : ` (giá trị: ${JSON.stringify(i.value)})`;
  return `${i.path}: ${i.message}${v}`;
}

export type SeedPlan = {
  providers: SeedProvider[];
  profiles: SeedProfile[];
  agents: (Omit<SeedAgent, "profile"> & { profile: string })[];
  orchestrator: SeedOrchestrator;
  entitlements: SeedEntitlement[];
  grants: SeedGrant[];
};

export type SeedSource = { name: string; data: unknown };
export type PlanOptions = { appEnv: string; profile?: string };

type Merged = Omit<SeedPlan, "orchestrator" | "agents"> & {
  agents: SeedAgent[];
  orchestrator: SeedOrchestrator[];
};

export const isDevEnv = (appEnv: string): boolean => appEnv === "development" || appEnv === "test";

/** `HUB_SEED_PROFILE` trống → `fake-1` khi development/test, khác → `claude-sub-1` (plan §3.6). */
export function defaultSeedProfile(appEnv: string, profile?: string): string {
  if (profile) return profile;
  return isDevEnv(appEnv) ? "fake-1" : "claude-sub-1";
}

function valueAt(data: unknown, path: PropertyKey[]): unknown {
  let cur: unknown = data;
  for (const p of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<PropertyKey, unknown>)[p];
  }
  return cur;
}

function zodIssues(name: string, data: unknown, err: z.ZodError): SeedIssue[] {
  return err.issues.map((i) => ({
    path: `${name}: ${i.path.map(String).join(".") || "(gốc)"}`,
    message: i.message,
    value: valueAt(data, i.path),
  }));
}

function mergeSources(sources: SeedSource[]): Merged {
  const issues: SeedIssue[] = [];
  const m: Merged = {
    providers: [],
    profiles: [],
    agents: [],
    orchestrator: [],
    entitlements: [],
    grants: [],
  };
  for (const s of sources) {
    const r = SeedFileSchema.safeParse(s.data ?? {});
    if (!r.success) {
      issues.push(...zodIssues(s.name, s.data, r.error));
      continue;
    }
    m.providers.push(...r.data.providers);
    m.profiles.push(...r.data.model_profiles);
    m.agents.push(...r.data.agents);
    if (r.data.orchestrator) m.orchestrator.push(r.data.orchestrator);
    m.entitlements.push(...r.data.entitlements);
    m.grants.push(...r.data.grants);
  }
  if (issues.length) throw new SeedValidationError(issues);
  return m;
}

function checkUnique(issues: SeedIssue[], kind: string, keys: string[]): void {
  const seen = new Set<string>();
  for (const k of keys) {
    if (seen.has(k)) issues.push({ path: `${kind}.key`, message: "trùng key", value: k });
    seen.add(k);
  }
}

function checkRefs(m: Merged, issues: SeedIssue[]): void {
  const providers = new Set(m.providers.map((p) => p.key));
  const profiles = new Set(m.profiles.map((p) => p.key));
  const agents = new Set(m.agents.map((a) => a.key));
  for (const p of m.profiles)
    for (const s of p.steps)
      if (!providers.has(s.provider_key))
        issues.push({
          path: `model_profiles.${p.key}.steps.provider_key`,
          message: "provider không có trong seed",
          value: s.provider_key,
        });
  for (const a of m.agents)
    if (a.profile !== SEED_PROFILE_TOKEN && !profiles.has(a.profile))
      issues.push({
        path: `agents.${a.key}.profile`,
        message: "profile không có trong seed",
        value: a.profile,
      });
  const refs = [
    ...m.orchestrator.map((o) => ["orchestrator.agent", o.agent] as const),
    ...m.entitlements.map((e) => ["entitlements.agent", e.agent] as const),
    ...m.grants.map((g) => ["grants.agent", g.agent] as const),
  ];
  for (const [path, key] of refs)
    if (!agents.has(key)) issues.push({ path, message: "agent không có trong seed", value: key });
}

/** Bỏ provider `dev_only` ngoài development/test; bỏ step dùng provider đã bỏ; profile hết step thì bỏ (plan §3.6). */
function filterDevOnly(m: Merged, appEnv: string): Pick<SeedPlan, "providers" | "profiles"> {
  if (isDevEnv(appEnv)) return { providers: m.providers, profiles: m.profiles };
  const providers = m.providers.filter((p) => !p.dev_only);
  const kept = new Set(providers.map((p) => p.key));
  const profiles = m.profiles
    .map((p) => ({ ...p, steps: p.steps.filter((s) => kept.has(s.provider_key)) }))
    .filter((p) => p.steps.length > 0);
  return { providers, profiles };
}

/** Key không trùng, đúng một orchestrator, mọi tham chiếu có trong seed (trước khi lọc `dev_only`). */
function checkStructure(m: Merged): void {
  const issues: SeedIssue[] = [];
  checkUnique(
    issues,
    "providers",
    m.providers.map((p) => p.key),
  );
  checkUnique(
    issues,
    "model_profiles",
    m.profiles.map((p) => p.key),
  );
  checkUnique(
    issues,
    "agents",
    m.agents.map((a) => a.key),
  );
  if (m.orchestrator.length !== 1)
    issues.push({
      path: "orchestrator",
      message: "phải khai đúng một mục orchestrator (HUB-BR-08)",
      value: m.orchestrator.length,
    });
  checkRefs(m, issues);
  if (issues.length) throw new SeedValidationError(issues);
}

/** Gộp + kiểm toàn bộ seed. Lỗi nào cũng ném `SeedValidationError` trước khi chạm DB (A43: không ghi dở). */
export function buildSeedPlan(sources: SeedSource[], o: PlanOptions): SeedPlan {
  const m = mergeSources(sources);
  checkStructure(m);
  const issues: SeedIssue[] = [];
  const { providers, profiles } = filterDevOnly(m, o.appEnv);
  const seedProfile = defaultSeedProfile(o.appEnv, o.profile);
  const usable = new Set(profiles.map((p) => p.key));
  const agents = m.agents.map((a) => ({
    ...a,
    profile: a.profile === SEED_PROFILE_TOKEN ? seedProfile : a.profile,
  }));
  for (const a of agents)
    if (!usable.has(a.profile))
      issues.push({
        path: `agents.${a.key}.profile`,
        message: `profile không dùng được khi APP_ENV=${o.appEnv}`,
        value: a.profile,
      });
  if (issues.length) throw new SeedValidationError(issues);
  const orchestrator = m.orchestrator[0] as SeedOrchestrator;
  return {
    providers,
    profiles,
    agents,
    orchestrator,
    entitlements: m.entitlements,
    grants: m.grants,
  };
}

/** `user:lan` → {type:"user", name:"lan"} (schema đã kiểm dạng). */
export function parseSubject(subject: string): { type: "user" | "group"; name: string } {
  const i = subject.indexOf(":");
  return { type: subject.slice(0, i) === "user" ? "user" : "group", name: subject.slice(i + 1) };
}
