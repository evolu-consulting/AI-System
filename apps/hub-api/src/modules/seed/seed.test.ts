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
  it("HUB-FR-60 · development: có fake-cli, agent orchestrator + assistant dùng fake-1", () => {
    const p = buildSeedPlan(defaults(), { appEnv: "development" });
    expect(p.providers.map((x) => x.key).sort()).toEqual(["claude-sub", "fake-cli"]);
    expect(p.agents.map((a) => [a.key, a.profile])).toEqual([
      ["orchestrator", "fake-1"],
      ["assistant", "fake-1"],
    ]);
    expect(p.orchestrator).toMatchObject({ agent: "orchestrator", token_budget: 200_000 });
    expect(p.grants.map((g) => g.subject)).toContain("group:beta-testers");
  });

  it("HUB-FR-61 · production: bỏ provider dev_only và profile hết step, agent dùng claude-sub-1", () => {
    const p = buildSeedPlan(defaults(), { appEnv: "production" });
    expect(p.providers.map((x) => x.key)).toEqual(["claude-sub"]);
    expect(p.profiles.map((x) => x.key)).toEqual(["claude-sub-1"]);
    expect(new Set(p.agents.map((a) => a.profile))).toEqual(new Set(["claude-sub-1"]));
  });

  it("HUB-FR-61 · HUB_SEED_PROFILE ghi đè mặc định; production + fake-1 → lỗi nêu profile", () => {
    const p = buildSeedPlan(defaults(), { appEnv: "test", profile: "claude-sub-1" });
    expect(p.agents.every((a) => a.profile === "claude-sub-1")).toBe(true);
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
  });
});
