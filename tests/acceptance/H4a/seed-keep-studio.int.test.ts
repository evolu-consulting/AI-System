// seed-keep-studio · `hub:seed` khong ghi de cot agent da doi qua Studio; agent chua ai sua van nhan thay doi yaml.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHubSeed } from "../../../apps/hub-api/src/modules/seed/seed";
import { OWNER_URL } from "../H1/_fixtures";
import { agentByKey, type Ctx, cliBody, pa, putOf, startH4a } from "./_h4a";

let x: Ctx;
beforeAll(async () => {
  x = await startH4a();
}, 60_000);
afterAll(async () => {
  await x?.stop();
});

const agent = (key: string, timeout: number, prompt: string, packs = false) => `  - key: ${key}
    name: { vi: ${key}, en: ${key} }
    description: Agent thu cua test seed-keep-studio, khong dung that.
    runtime: agentic-cli
    profile: fake-1
    timeout_s: ${timeout}
    system_prompt: ${prompt}${packs ? "\n    runtime_options:\n      pack_tools: [knowledge-search]" : ""}
`;
const yaml = (timeout: number, prompt: string, packs = false) => `providers:
  - key: fake-cli
    kind: subscription
    vendor: fake
    max_concurrency: 2
model_profiles:
  - key: fake-1
    steps:
      - provider_key: fake-cli
  - key: fake-2
    steps:
      - provider_key: fake-cli
agents:
${agent("ks-a", timeout, prompt, packs)}${agent("ks-b", timeout, prompt, packs)}orchestrator:
  agent: ks-a
`;
async function seed(timeout: number, prompt: string, packs = false): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "seed-keep-studio-"));
  try {
    writeFileSync(join(dir, "00-base.yaml"), yaml(timeout, prompt, packs));
    await runHubSeed({ url: OWNER_URL, dir, appEnv: "test" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("seed-keep-studio", () => {
  it("profile doi qua Studio duoc giu sau seed; truong khong ai sua + agent khac van theo yaml", async () => {
    await seed(600, "prompt v1");
    const a = await agentByKey(x.sql, "ks-a");
    const [p2] = await x.sql`select id from hub.model_profiles where key = 'fake-2'`;
    const profile2 = String(p2?.id);
    expect(a?.profile_id).not.toBe(profile2);

    const r = await pa(
      x,
      "PUT",
      `/agents/${a?.id}`,
      putOf(
        cliBody("ks-a", {
          profile_id: profile2,
          system_prompt: String(a?.system_prompt),
          name: a?.name,
          description: a?.description,
          runtime_options: a?.runtime_options,
          timeout_s: 600,
        }),
        Number(a?.version),
      ),
    );
    expect(r.status).toBe(200);
    const after = await agentByKey(x.sql, "ks-a");
    // runtime_options: Studio chuan hoa them mac dinh cli ⇒ cung bi danh dau; profile_id phai co, timeout_s khong.
    expect(after?.studio_overrides).toContain("profile_id");
    expect(after?.studio_overrides).not.toContain("timeout_s");

    await seed(700, "prompt v2", true);
    const a2 = await agentByKey(x.sql, "ks-a");
    const b2 = await agentByKey(x.sql, "ks-b");
    expect(a2?.profile_id).toBe(profile2);
    expect(a2?.timeout_s).toBe(700);
    expect(a2?.system_prompt).toBe("prompt v2");
    expect(b2?.timeout_s).toBe(700);
    expect(b2?.studio_overrides).toEqual([]);
    // Studio luu lai options khong doi (chi them mac dinh cli) khong danh dau; khoa moi tu yaml van toi agent da luu qua Studio
    expect(a2?.studio_overrides).not.toContain("runtime_options");
    expect(a2?.runtime_options).toMatchObject({ pack_tools: ["knowledge-search"] });
  }, 60_000);
});
