// HUB-FR-60, HUB-FR-61, HUB-FR-62 · H1-R16 · unit: parse/gộp/kiểm seed yaml (không DB).
import { describe, expect, it } from "bun:test";
import { DEFAULT_SEED_DIR, loadSeedCliEnv, readSeedDir } from "./seed";
import {
  buildSeedPlan,
  defaultSeedProfile,
  parseSubject,
  type SeedSource,
  SeedValidationError,
} from "./seed.rules";

const defaults = (): SeedSource[] => readSeedDir(DEFAULT_SEED_DIR);
/** CR-081 · nạp kèm `*.full.yaml` (fixtures opt-in). */
const full = (): SeedSource[] => readSeedDir(DEFAULT_SEED_DIR, true);

/** Phần tử thứ i (ném nếu thiếu, khỏi dùng `!`). */
function at<T>(arr: T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`thiếu phần tử ${i}`);
  return v;
}

function thrown(fn: () => unknown): SeedValidationError {
  try {
    fn();
  } catch (e) {
    if (e instanceof SeedValidationError) return e;
    throw e;
  }
  throw new Error("không ném");
}

/** Bản sao seed mặc định, sửa dữ liệu đã parse của file `name`. */
function patched(name: string, edit: (d: Record<string, unknown>) => void): SeedSource[] {
  return defaults().map((s) => {
    if (s.name !== name) return s;
    const data = structuredClone(s.data) as Record<string, unknown>;
    edit(data);
    return { name, data };
  });
}

describe("HUB-FR-60 · seed yaml mặc định", () => {
  it("HUB-FR-60 · CR-081 · M2-chat · development tối giản: fake-cli + dify, đúng 6 agent, mọi agent fake-1", () => {
    const p = buildSeedPlan(defaults(), { appEnv: "development" });
    expect(p.providers.map((x) => x.key).sort()).toEqual([
      "claude-sub",
      "claude-sub-haiku",
      "claude-sub-opus",
      "dify",
      "fake-cli",
    ]);
    // CR-081: mặc định bỏ `*.full.yaml` ⇒ chỉ agent của agents.yaml, không agent vai.
    expect(p.agents.map((a) => a.key)).toEqual([
      "orchestrator",
      "assistant",
      "mgmt-assistant",
      "mgmt-assistant-dify",
      "dify-tom",
      "dify-tro-ly",
    ]);
    expect(p.agents).toHaveLength(6);
    // M2-chat · trợ lý app mgmt: Claude + tool ĐỌC gói contracts (không tool CLI/tệp).
    const mgmt = p.agents.find((a) => a.key === "mgmt-assistant");
    expect(mgmt?.runtime).toBe("agentic-cli");
    expect(mgmt?.runtime_options).toEqual({
      allowed_tools: [],
      pack_tools: [
        "contracts-search",
        "contracts-get",
        "contracts-cks",
        "contracts-ledger",
        "knowledge-search",
        "knowledge-get",
        "app-guide",
      ],
    });
    // ai-tiers-rag · trợ lý chung: tool tri thức, giữ công cụ đọc tệp (không khai allowed_tools); chat-fast2: + tool đọc contracts.
    expect(p.agents.find((a) => a.key === "assistant")?.runtime_options).toEqual({
      pack_tools: [
        "knowledge-search",
        "knowledge-get",
        "app-guide",
        "contracts-search",
        "contracts-get",
        "contracts-cks",
        "contracts-ledger",
      ],
    });
    // M2-chat · cùng trợ lý, backend Dify (token chat ngắn hạn cho tool đọc).
    expect(p.agents.find((a) => a.key === "mgmt-assistant-dify")?.runtime_options).toEqual({
      workflow_key: "mgmt-assistant",
      pack_tools: ["contracts-search", "contracts-get", "contracts-cks", "contracts-ledger"],
    });
    expect(p.grants.filter((g) => g.agent === "mgmt-assistant").map((g) => g.subject)).toContain(
      "group:contracts-viewer",
    );
    expect(p.agents.every((a) => a.profile === "fake-1")).toBe(true);
    expect(p.orchestrator).toMatchObject({ agent: "orchestrator", token_budget: 200_000 });
    // grant assistant × acme/beta (access.yaml) vẫn ở seed tối giản.
    expect(p.grants.map((g) => g.subject)).toContain("group:beta-testers");
  });

  it("HUB-FR-60 · CR-081 · HUB_SEED_FIXTURES ⇒ nạp thêm processes.full.yaml: 20 agent", () => {
    const p = buildSeedPlan(full(), { appEnv: "development" });
    expect(p.agents.slice(0, 6).map((a) => a.key)).toEqual([
      "orchestrator",
      "assistant",
      "mgmt-assistant",
      "mgmt-assistant-dify",
      "dify-tom",
      "dify-tro-ly",
    ]);
    // + hoa-don-doc + 8 agent vai + 4 agent nhóm BA + 3 agent fixbug (P-c1 B6) — mọi agent fake-1 ở development.
    expect(p.agents).toHaveLength(22);
    expect(p.agents.every((a) => a.profile === "fake-1")).toBe(true);
  });
});

describe("HUB-FR-60 · seed yaml mặc định (production, profile)", () => {
  it("HUB-FR-61 · ai-tiers-rag · production: bỏ provider dev_only; agent theo bậc claude-sub-fast/std, còn lại claude-sub-1", () => {
    const p = buildSeedPlan(defaults(), { appEnv: "production" });
    expect(p.providers.map((x) => x.key)).toEqual([
      "claude-sub",
      "claude-sub-haiku",
      "claude-sub-opus",
      "dify",
    ]);
    expect(p.profiles.map((x) => x.key)).toEqual([
      "claude-sub-1",
      "claude-sub-fast",
      "claude-sub-std",
      "claude-sub-deep",
    ]);
    const by = Object.fromEntries(p.agents.map((a) => [a.key, a.profile]));
    expect(by).toMatchObject({
      orchestrator: "claude-sub-fast",
      assistant: "claude-sub-std",
      "mgmt-assistant": "claude-sub-std",
      "dify-tom": "claude-sub-1",
    });
    const deep = buildSeedPlan(full(), { appEnv: "production" }).agents;
    expect(deep.find((a) => a.key === "fixbug-engineer")?.profile).toBe("claude-sub-deep");
  });

  it("HUB-FR-61 · HUB_SEED_PROFILE ghi đè mặc định; production + fake-1 → lỗi nêu profile", () => {
    const p = buildSeedPlan(defaults(), { appEnv: "test", profile: "claude-sub-1" });
    expect(p.agents.every((a) => a.profile.startsWith("claude-sub-"))).toBe(true);
    // profile ghi đè không có bậc (vd fake-1) ⇒ mọi agent dùng đúng profile đó
    const f = buildSeedPlan(full(), { appEnv: "test", profile: "fake-1" });
    expect(f.agents.every((a) => a.profile === "fake-1")).toBe(true);
    const e = thrown(() => buildSeedPlan(defaults(), { appEnv: "production", profile: "fake-1" }));
    expect(e.message).toContain("fake-1");
    expect(defaultSeedProfile("test")).toBe("fake-1");
    expect(defaultSeedProfile("production")).toBe("claude-sub-1");
  });
});

describe("H1-R16 · seed sai → SeedValidationError nêu trường/giá trị", () => {
  it("H1-R16 · key agent sai định dạng", () => {
    const src = patched("agents.yaml", (d) => {
      at(d.agents as { key: string }[], 1).key = "Bad";
    });
    const e = thrown(() => buildSeedPlan(src, { appEnv: "test" }));
    expect(e.message).toMatch(/agents\.1\.key/);
    expect(e.message).toContain('"Bad"');
  });

  it("H1-R16 · trường lạ (secret) bị từ chối", () => {
    const src = patched("providers.yaml", (d) => {
      at(d.providers as Record<string, unknown>[], 0).secret = "x";
    });
    expect(thrown(() => buildSeedPlan(src, { appEnv: "test" })).message).toContain("providers.0");
  });

  it("H1-R16 · provider lạ trong profile, agent lạ trong grant, trùng key, thiếu orchestrator", () => {
    const bad = patched("providers.yaml", (d) => {
      at(at(d.model_profiles as { steps: { provider_key: string }[] }[], 0).steps, 0).provider_key =
        "khong-co";
    });
    expect(thrown(() => buildSeedPlan(bad, { appEnv: "test" })).message).toMatch(
      /provider_key.*khong-co/,
    );
    const grant = patched("access.yaml", (d) => {
      at(d.grants as { agent: string }[], 0).agent = "khong-co";
    });
    expect(thrown(() => buildSeedPlan(grant, { appEnv: "test" })).message).toMatch(
      /grants\.agent.*khong-co/,
    );
    const dup = [
      ...defaults(),
      { name: "zz.yaml", data: { providers: [{ key: "fake-cli", kind: "api", vendor: "fake" }] } },
    ];
    expect(thrown(() => buildSeedPlan(dup, { appEnv: "test" })).message).toContain("trùng key");
    const noOrch = patched("agents.yaml", (d) => {
      delete d.orchestrator;
    });
    expect(thrown(() => buildSeedPlan(noOrch, { appEnv: "test" })).message).toContain(
      "orchestrator",
    );
  });
});

describe("HUB-FR-62 · H2b-R13 · orchestrator_tenants trong yaml", () => {
  it("HUB-FR-62 · seed mặc định không có mục → []; gộp mục của nhiều file; trường lạ bị từ chối", () => {
    expect(buildSeedPlan(defaults(), { appEnv: "test" }).orchestratorTenants).toEqual([]);
    const extra: SeedSource[] = [
      {
        name: "90-a.yaml",
        data: { orchestrator_tenants: [{ tenant_key: "acme", agent: "assistant" }] },
      },
      { name: "91-b.yaml", data: { orchestrator_tenants: [{ tenant_key: "beta", remove: true }] } },
    ];
    expect(
      buildSeedPlan([...defaults(), ...extra], { appEnv: "test" }).orchestratorTenants,
    ).toEqual([
      { tenant_key: "acme", agent: "assistant" },
      { tenant_key: "beta", remove: true },
    ]);
    const bad: SeedSource = {
      name: "92-c.yaml",
      data: { orchestrator_tenants: [{ tenant_key: "acme", agent: "assistant", secret: "x" }] },
    };
    expect(thrown(() => buildSeedPlan([...defaults(), bad], { appEnv: "test" })).message).toContain(
      "orchestrator_tenants.0",
    );
  });
});

describe("HUB-FR-62 · tiện ích", () => {
  it("HUB-FR-62 · parseSubject", () => {
    expect(parseSubject("user:lan")).toEqual({ type: "user", name: "lan" });
    expect(parseSubject("group:beta-testers")).toEqual({ type: "group", name: "beta-testers" });
  });

  it("HUB-FR-60 · env CLI: lỗi chỉ nêu tên biến; HUB_SEED_DIR/PROFILE tuỳ chọn", () => {
    expect(() => loadSeedCliEnv({ DATABASE_URL: "postgres://u:secretpw@h/db" })).toThrow(/APP_ENV/);
    try {
      loadSeedCliEnv({ DATABASE_URL: "x", APP_ENV: "test" });
    } catch (e) {
      expect((e as Error).message).not.toContain("secretpw");
    }
    const o = loadSeedCliEnv({
      DATABASE_URL: "postgres://u:p@h/db",
      APP_ENV: "test",
      HUB_SEED_PROFILE: "",
    });
    expect(o).toMatchObject({ dir: DEFAULT_SEED_DIR, appEnv: "test", profile: undefined });
    // CR-081: HUB_SEED_FIXTURES vắng ⇒ fixtures=false; "1" ⇒ true.
    expect(o.fixtures).toBe(false);
    const f = loadSeedCliEnv({
      DATABASE_URL: "postgres://u:p@h/db",
      APP_ENV: "test",
      HUB_SEED_FIXTURES: "1",
    });
    expect(f.fixtures).toBe(true);
  });
});
