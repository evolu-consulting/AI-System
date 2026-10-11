// P-b · PF-S1 · HUB-FR-120/121 · PB-R01/02/06 · R-C01…R-C24, R-C26 (test-plan §4.1): schema contract nguồn + process_defs.
// Tra schema theo TÊN trong các entry `@ai/contracts*` (không import tên chưa tồn tại ⇒ biên dịch được trước code S1);
// thiếu export ⇒ ca đỏ ở `expect(schema).toBeDefined()`. Luật thuần, không DB.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as root from "@ai/contracts";
import * as chat from "@ai/contracts/chat";
import * as hub from "@ai/contracts/hub";
import * as admin from "@ai/contracts/hub-admin";
import * as internal from "@ai/contracts/hub-internal";

type Zod = {
  safeParse: (v: unknown) => { success: boolean; error?: { issues: { path: unknown[] }[] } };
};
const pools = [admin, hub, internal, chat, root] as Record<string, unknown>[];
function S(name: string): Zod {
  const hit = pools.map((p) => p[name]).find((v) => v !== undefined);
  expect({ [name]: hit !== undefined }).toEqual({ [name]: true });
  return hit as Zod;
}
const ok = (name: string, v: unknown) => S(name).safeParse(v).success;
const U = "b1b10000-0000-4000-8000-000000000001";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const GIT = { kind: "git_remote", url: "https://github.com/pb-test/app-repo.git", branch: "main" };

describe("R-C01…R-C05 · kiểu cơ sở [PB-R01, PB-R02, PB-R19]", () => {
  it("PB-R01 · R-C01 · SourceKey", () => {
    for (const k of ["app-repo", "ab", "a1-b2"])
      expect([k, ok("SourceKeySchema", k)]).toEqual([k, true]);
    for (const k of ["a", "App", "a_b", "a".repeat(33), ""])
      expect([k, ok("SourceKeySchema", k)]).toEqual([k, false]);
  });

  it("PB-R02 · R-C02 · GitUrl chỉ https, không credential", () => {
    expect(ok("GitUrlSchema", "https://github.com/pb-test/app-repo.git")).toBe(true);
    for (const u of [
      "http://github.com/x/y",
      "file:///x",
      "ssh://git@github.com/x/y",
      "git://github.com/x/y",
      "ext::sh -c x",
      "https://u:p@github.com/x",
      "https://tok@github.com/x",
    ])
      expect([u, ok("GitUrlSchema", u)]).toEqual([u, false]);
  });

  it("PB-R19 · R-C03 · Branch", () => {
    for (const b of ["main", "feature/x"]) expect(ok("BranchSchema", b)).toBe(true);
    for (const b of ["-x", "--upload-pack=x", "", "a".repeat(256)])
      expect([b, ok("BranchSchema", b)]).toEqual([b, false]);
  });

  it("PB-R06 · R-C04 · Glob tương đối, không .., không tuyệt đối", () => {
    for (const g of ["src/**", "**/*.md"]) expect(ok("GlobSchema", g)).toBe(true);
    for (const g of ["../x", "a/../b", "/etc", "", "a\0b", "a".repeat(257)])
      expect([g, ok("GlobSchema", g)]).toEqual([g, false]);
  });

  it("PB-R05 · R-C05 · SourcePin", () => {
    expect(ok("SourcePinSchema", { kind: "git_remote", url: GIT.url, sha: SHA })).toBe(true);
    for (const sha of [SHA.slice(1), `${SHA}0`, SHA.toUpperCase()])
      expect(ok("SourcePinSchema", { kind: "git_remote", url: GIT.url, sha })).toBe(false);
    expect(ok("SourcePinSchema", { kind: "local_path", path: "/r/x", snapshot_id: U })).toBe(true);
    expect(ok("SourcePinSchema", { kind: "library", document_id: U, version: U })).toBe(true);
    expect(ok("SourcePinSchema", { kind: "library", document_id: U, version: "v1" })).toBe(false);
  });
});

describe("R-C06…R-C10 · config + request [PB-R01, PB-R21]", () => {
  it("PB-R01 · R-C06 · SourceConfig strict", () => {
    expect(ok("SourceConfigSchema", GIT)).toBe(true);
    expect(ok("SourceConfigSchema", { ...GIT, extra: 1 })).toBe(false);
    expect(ok("SourceConfigSchema", { kind: "git_remote", url: GIT.url })).toBe(false);
    expect(ok("SourceConfigSchema", { kind: "svn", url: GIT.url })).toBe(false);
  });

  it("PB-R21 · R-C07 · SourceConfigPublic: local_path không có path; git_remote còn url", () => {
    expect(ok("SourceConfigPublicSchema", { kind: "local_path" })).toBe(true);
    expect(ok("SourceConfigPublicSchema", { kind: "local_path", path: "/r" })).toBe(false);
    expect(ok("SourceConfigPublicSchema", GIT)).toBe(true);
  });

  it("HUB-FR-120 · R-C08 · SourceCreateRequest", () => {
    const base = { key: "app-repo", kind: "git_remote", config: GIT, description: "d" };
    expect(ok("SourceCreateRequestSchema", base)).toBe(true);
    expect(ok("SourceCreateRequestSchema", { ...base, description: "x".repeat(501) })).toBe(false);
    expect(ok("SourceCreateRequestSchema", { ...base, tenant_id: "khong-uuid" })).toBe(false);
  });

  it("HUB-FR-120 · R-C09 · SourceListQuery limit 1..100, mặc định 20", () => {
    expect(ok("SourceListQuerySchema", { limit: "0" })).toBe(false);
    expect(ok("SourceListQuerySchema", { limit: "101" })).toBe(false);
    const r = S("SourceListQuerySchema").safeParse({}) as unknown as {
      success: boolean;
      data?: { limit: number };
    };
    expect(r.data?.limit).toBe(20);
  });

  it("HUB-FR-120 · R-C10 · SourceDeleteQuery cần version ≥ 1", () => {
    expect(ok("SourceDeleteQuerySchema", {})).toBe(false);
    expect(ok("SourceDeleteQuerySchema", { version: "0" })).toBe(false);
    expect(ok("SourceDeleteQuerySchema", { version: "1" })).toBe(true);
  });
});

describe("R-C11…R-C15 · process_defs [HUB-FR-121, PB-R06, HUB-FR-125]", () => {
  it("HUB-FR-121 · R-C11 · ProcessInputDef", () => {
    const base = { key: "env", label: "Môi trường", required: false };
    expect(ok("ProcessInputDefSchema", { ...base, type: "select", options: ["dev", "stg"] })).toBe(
      true,
    );
    expect(ok("ProcessInputDefSchema", { ...base, type: "text", options: ["dev"] })).toBe(false);
    expect(
      ok("ProcessInputDefSchema", { ...base, type: "select", options: Array(21).fill("a") }),
    ).toBe(false);
    expect(ok("ProcessInputDefSchema", { ...base, type: "text", label: "x".repeat(81) })).toBe(
      false,
    );
    expect(ok("ProcessInputDefSchema", { ...base, type: "lạ" })).toBe(false);
  });

  it("PB-R06 · R-C12 · StageSource.allowlist ≤ 20", () => {
    expect(
      ok("StageSourceSchema", { source_key: "app-repo", allowlist: Array(20).fill("a") }),
    ).toBe(true);
    expect(
      ok("StageSourceSchema", { source_key: "app-repo", allowlist: Array(21).fill("a") }),
    ).toBe(false);
  });

  it("PB-R06 · HUB-FR-125 · R-C13 · stage sources ≤ 5; must_know ≤ 10 × 200", async () => {
    const stage = async (o: Record<string, unknown>) => ({ ...(await stageFix()), ...o });
    const srcs = (n: number) =>
      Array.from({ length: n }, () => ({ source_key: "app-repo", allowlist: [] }));
    const sch = "ProcessStageDefSchema";
    expect(ok(sch, await stage({ sources: srcs(5) }))).toBe(true);
    expect(ok(sch, await stage({ sources: srcs(6) }))).toBe(false);
    expect(ok(sch, await stage({ must_know: Array(10).fill("hỏi") }))).toBe(true);
    expect(ok(sch, await stage({ must_know: Array(11).fill("hỏi") }))).toBe(false);
    expect(ok(sch, await stage({ must_know: ["x".repeat(201)] }))).toBe(false);
  });

  it("HUB-FR-121 · R-C14 · def sources ≤ 20, inputs ≤ 10", async () => {
    const def = await defFix();
    const keys = (n: number) =>
      Array.from({ length: n }, (_, i) => `src-${String(i).padStart(2, "0")}`);
    const inp = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        key: `k${i}`,
        label: "L",
        type: "text",
        required: false,
      }));
    expect(ok("ProcessDefInputBaseSchema", { ...def, sources: keys(20), inputs: inp(10) })).toBe(
      true,
    );
    expect(ok("ProcessDefInputBaseSchema", { ...def, sources: keys(21) })).toBe(false);
    expect(ok("ProcessDefInputBaseSchema", { ...def, inputs: inp(11) })).toBe(false);
  });

  it("HUB-FR-121 · R-C15 · superRefine: stage.sources[].source_key ∉ def.sources ⇒ issue path stages.0.sources.0.source_key", async () => {
    const def = await defFix({
      sources: ["app-repo"],
      stageSources: [{ source_key: "khac-key", allowlist: [] }],
    });
    const r = S("ProcessDefInputSchema").safeParse(def);
    expect(r.success).toBe(false);
    const paths = (r.error?.issues ?? []).map((i) => i.path.join("."));
    expect(paths).toContain("stages.0.sources.0.source_key");
  });

  it("HUB-FR-121 · R-C26 · def P-a cũ (không sources/inputs/must_know) parse ⇒ mặc định []", async () => {
    const def = await defFix();
    const r = S("ProcessDefInputBaseSchema").safeParse(def) as unknown as {
      success: boolean;
      data?: {
        sources: unknown;
        inputs: unknown;
        stages: { sources?: unknown; must_know?: unknown }[];
      };
    };
    expect(r.success).toBe(true);
    expect(r.data?.sources).toEqual([]);
    expect(r.data?.inputs).toEqual([]);
    expect(r.data?.stages[0]?.sources).toEqual([]);
    expect(r.data?.stages[0]?.must_know).toEqual([]);
  });
});

describe("R-C16…R-C23 · input, job, kênh resolve [HUB-FR-122, HUB-FR-124, PB-R05, PB-R13]", () => {
  it("PB-R13 · R-C16 · ProcessInputValue: 4 type hợp lệ; source_ref.branch=-x, type lạ ⇒ lỗi", () => {
    const sch = "ProcessInputValueSchema";
    expect(ok(sch, { type: "text", key: "goal", text: "Thêm nút xuất" })).toBe(true);
    expect(
      ok(sch, { type: "source_ref", key: "repo", source_key: "app-repo", branch: "dev" }),
    ).toBe(true);
    expect(ok(sch, { type: "source_ref", key: "repo", source_key: "app-repo", branch: "-x" })).toBe(
      false,
    );
    expect(ok(sch, { type: "lạ", key: "k" })).toBe(false);
  });

  it("PB-R13 · R-C17 · RunProcessDefRequest không inputs vẫn hợp lệ (tương thích P-a); 11 phần tử ⇒ lỗi", () => {
    expect(ok("RunProcessDefRequestSchema", { input: "HD-12" })).toBe(true);
    const many = Array.from({ length: 11 }, (_, i) => ({ type: "text", key: `k${i}`, text: "a" }));
    expect(ok("RunProcessDefRequestSchema", { input: "HD-12", inputs: many.slice(0, 10) })).toBe(
      true,
    );
    expect(ok("RunProcessDefRequestSchema", { input: "HD-12", inputs: many })).toBe(false);
  });

  it("PB-R10 · R-C18 · AgentCliJob.sources ≤ 5; JobSource.allowlist ≤ 20", () => {
    const js = (n: number) => ({
      key: "app-repo",
      kind: "git_remote",
      pin: { kind: "git_remote", url: GIT.url, sha: SHA },
      allowlist: Array(n).fill("a"),
    });
    expect(ok("JobSourceSchema", js(20))).toBe(true);
    expect(ok("JobSourceSchema", js(21))).toBe(false);
    const shape =
      (S("AgentCliJobSchema") as unknown as { shape?: Record<string, unknown> }).shape ?? {};
    expect(Object.keys(shape)).toContain("sources");
  });

  it("PB-R05 · R-C19 · SourceResolveJob: items 1..20, timeout_s 10..300", () => {
    const item = {
      source_id: U,
      key: "app-repo",
      kind: "git_remote",
      config: GIT,
      allowlist_union: [],
    };
    const job = (o: Record<string, unknown>) => ({
      v: 1,
      type: "source.resolve",
      job_id: U,
      tenant_id: U,
      process_run_id: null,
      items: [item],
      timeout_s: 60,
      ...o,
    });
    const sch = "SourceResolveJobSchema";
    expect(ok(sch, job({}))).toBe(true);
    expect(ok(sch, job({ items: [] }))).toBe(false);
    expect(ok(sch, job({ items: Array(21).fill(item) }))).toBe(false);
    for (const t of [9, 301]) expect([t, ok(sch, job({ timeout_s: t }))]).toEqual([t, false]);
    for (const t of [10, 300]) expect([t, ok(sch, job({ timeout_s: t }))]).toEqual([t, true]);
    expect(ok("JobPayloadSchema", job({}))).toBe(true); // R-C20
  });

  it("PB-R05 · R-C21 · ResolveResult: ok thiếu pin ⇒ lỗi; error code lạ ⇒ lỗi; 4 mã SOURCE_* hợp lệ", () => {
    const sch = "ResolveResultSchema";
    expect(ok(sch, { status: "ok", source_id: U, files: 1, bytes: 1 })).toBe(false);
    expect(ok(sch, { status: "error", source_id: U, code: "FOO" })).toBe(false);
    for (const c of [
      "SOURCE_UNRESOLVABLE",
      "SOURCE_TOO_LARGE",
      "SOURCE_HOST_NOT_ALLOWED",
      "SOURCE_FORBIDDEN_KIND",
    ])
      expect([c, ok(sch, { status: "error", source_id: U, code: c })]).toEqual([c, true]);
  });

  it("PB-R05 · R-C22 · SourcesResolvedRequest: results [] ⇒ lỗi", () => {
    expect(ok("SourcesResolvedRequestSchema", { results: [] })).toBe(false);
  });

  it("PB-R21 · R-C23 · DECISION_REASONS có source_unresolvable; ProcessSourceChip strict", () => {
    const reasons = pools.map((p) => p.DECISION_REASONS).find((v) => v !== undefined) as
      | string[]
      | undefined;
    expect(reasons).toContain("source_unresolvable");
    expect(
      ok("ProcessSourceChipSchema", { key: "app-repo", kind: "git_remote", description: "d" }),
    ).toBe(true);
    expect(
      ok("ProcessSourceChipSchema", {
        key: "app-repo",
        kind: "git_remote",
        description: "d",
        config: GIT,
      }),
    ).toBe(false);
  });

  it("PB-R05 · R-C25 · pydantic hub.py sinh ra có SourceResolveJob và sources trong JobPayload1", () => {
    const text = readFileSync(
      join(process.cwd(), "apps/agent-runtime/src/agent_runtime/contracts/hub.py"),
      "utf8",
    );
    expect(text).toContain("SourceResolveJob");
    expect(text).toMatch(/class JobPayload1[\s\S]*?sources/);
  });
});

describe("R-C24 · mã lỗi nguồn [PB-R01..R03, HUB-BR-14]", () => {
  it("HUB-FR-120 · R-C24 · SOURCE_ERRORS: 7 mã + HTTP", () => {
    const e = (hit() as Record<string, number> | undefined) ?? {};
    expect(e).toEqual({
      SOURCE_KEY_TAKEN: 409,
      SOURCE_HOST_NOT_ALLOWED: 422,
      SOURCE_UNRESOLVABLE: 422,
      SOURCE_IN_USE: 409,
      SOURCE_FORBIDDEN_KIND: 403,
      SOURCE_TOO_LARGE: 422,
      SOURCE_NOT_FOUND: 404,
    });
    function hit(): unknown {
      return pools.map((p) => p.SOURCE_ERRORS).find((v) => v !== undefined);
    }
  });
});

// ---------- fixture nhỏ: lấy stage/def hợp lệ P-a từ chính contract test-fixtures (không import file P-a trong rules) ----------
async function stageFix(): Promise<Record<string, unknown>> {
  return {
    key: "s1",
    name: "Đọc nguồn",
    executor: { kind: "agent", agent_id: U },
    instruction: "Đọc và tóm tắt.",
    output: { filename: "out.md", template: "## A\n", required_sections: ["A"], fields: [] },
    after: { kind: "auto" },
    real_action: false,
    answerer: { kind: "starter" },
    timeout_s: 600,
    token_budget: null,
  };
}
async function defFix(
  o: { sources?: string[]; stageSources?: unknown[] } = {},
): Promise<Record<string, unknown>> {
  const stage: Record<string, unknown> = await stageFix();
  if (o.stageSources) stage.sources = o.stageSources;
  return {
    key: "p-rules",
    name: "Quy trình rules",
    description: "d",
    input_hint: "",
    run_group_ids: [],
    stages: [stage],
    token_budget: null,
    enabled: true,
    ...(o.sources ? { sources: o.sources } : {}),
  };
}
