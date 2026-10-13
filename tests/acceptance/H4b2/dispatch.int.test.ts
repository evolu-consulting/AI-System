// HUB-FR-67 · HUB-FR-31 (phần lúc giao job, Q4) · AC-H4b2-07 (thay AC-H04 nguyên văn — dời H2d) · plan H4b2 §2.3, §3.4 ·
// test-plan H4b2 §3 D01–D09: giao job theo `pickStep` — bước provider tắt bỏ qua vô điều kiện; bước bị chặn (cooldown ⇒
// quota, logged_out/error ⇒ error) chỉ chuyển bước kế khi `on` có trigger; không bước nào ⇒ run.failed
// ALL_PROVIDERS_EXHAUSTED, không tạo job; payload job giữ contract (`profile_steps` = [bước đã chọn], `step_index` 0).
// Hộp đen: hub-api thật + DB + Redis; test đóng vai Runtime (`ScriptRuntime` H1). Cấu hình đổi bằng owner + bump/NOTIFY,
// chờ ảnh cache Hub ≥ version qua `GET /agent-grants/effective` (H3b F4). Đỏ trước code: job vẫn ở bước 0 / run lỗi ngay.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { EffectiveAgentsResponseSchema } from "@ai/contracts/hub-admin";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import {
  call,
  insertFixture,
  type Json,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  type Sql,
  sign,
  USERS,
  waitFor,
} from "../H1/_fixtures";
import {
  type HubX,
  hubConfigChange,
  idGen,
  insertConv,
  insertHubConfig,
  PROFILE,
  runIdOf,
  type Sse,
  send,
  startHubX,
  testRedis,
} from "../H1/_hub";
import { ScriptRuntime } from "../H1/_runtime";
import { captureAll } from "../H4b1/_h4b1";

let sql: Sql;
let k: Keys;
let hub: HubX;
let redis: Redis;
let rt: ScriptRuntime;
let log: ReturnType<typeof captureAll>;
const id = idGen(4200);
const FUT = "2099-01-01T00:00:00Z";

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  k = await makeKeys();
  hub = await startHubX(k, { instanceId: "qc-hub-h4b2-dispatch" });
  redis = await testRedis();
  rt = new ScriptRuntime(sql, redis);
  log = captureAll();
}, 60_000);
afterAll(async () => {
  log?.restore();
  await hub?.stop();
  redis?.disconnect();
  await sql?.end();
});

type Step = { provider_key: string; model: string | null; on: string[] };
const s = (p: string, on: string[] = []): Step => ({ provider_key: p, model: null, on });
/** Đặt bước profile `fake-1` (Orchestrator dùng) + `enabled` claude-sub; bump + NOTIFY; chờ ảnh Hub ≥ version mới. */
async function configure(steps: Step[], claudeEnabled = true): Promise<void> {
  const v = await hubConfigChange(sql, async (tx) => {
    await tx`update hub.model_profiles set steps = ${sql.json(steps)} where id = ${PROFILE.fake}`;
    await tx`update hub.providers set enabled = ${claudeEnabled} where key = 'claude-sub'`;
  });
  const tk = await sign(k, USERS.tadmin);
  const r = await waitFor(
    () => call(hub, "GET", `/agent-grants/effective/${USERS.lan.id}`, { token: tk }),
    (res) => {
      const p = EffectiveAgentsResponseSchema.safeParse(res.json);
      return p.success && p.data.hub_config_version >= v;
    },
    10_000,
  );
  expect(r.status).toBe(200);
}
async function state(key: string, status: string, cooldown: string | null = null) {
  await sql`insert into hub.provider_state (provider_key, status, cooldown_until)
    values (${key}, ${status}, ${cooldown}::timestamptz)
    on conflict (provider_key) do update set status = excluded.status, cooldown_until = excluded.cooldown_until`;
}
async function resetStates() {
  await sql`delete from hub.provider_state where provider_key in ('claude-sub', 'fake-cli')`;
}
async function start(content: string): Promise<{ s: Sse; runId: string }> {
  const conv = await insertConv(sql, "lan", id());
  const sse = await send(hub, await sign(k, USERS.lan), conv, content);
  expect(sse.status).toBe(200);
  return { s: sse, runId: runIdOf(sse) };
}
/** Run kế: job Orchestrator đầu tiên (đóng vai Runtime trả lời để run kết thúc). */
async function firstJob(content: string): Promise<Json> {
  const { s: sse, runId } = await start(content);
  const job = await rt.next(runId, 10_000);
  const [row] = await sql`select provider_key from hub.jobs where id = ${job.id}`;
  await rt.decide(job, { decision: "answer", text: "Xong." });
  await sse.terminal(10_000);
  sse.close();
  return { payload: job.payload, provider_key: row?.provider_key };
}
async function failsExhausted(content: string): Promise<void> {
  const { s: sse, runId } = await start(content);
  const e = await sse.terminal(5_000);
  sse.close();
  expect(e?.event).toBe("run.failed");
  expect(e?.data?.code).toBe("ALL_PROVIDERS_EXHAUSTED");
  const [j] = await sql<
    { n: number }[]
  >`select count(*)::int as n from hub.jobs where run_id = ${runId}`;
  expect(j?.n).toBe(0);
}

describe("D01–D09 · dự phòng lúc giao job [AC-H4b2-07 · Q4 · plan §3.4]", () => {
  it("HUB-FR-67 · AC-H4b2-07 · D01 · [claude-sub on quota, fake-cli], claude-sub cooldown ⇒ job ở fake-cli; payload profile_steps = [fake-cli], step_index 0", async () => {
    await configure([s("claude-sub", ["quota"]), s("fake-cli")]);
    await state("claude-sub", "cooldown", FUT);
    try {
      const j = await firstJob("Câu D01");
      expect(j.provider_key).toBe("fake-cli");
      expect(j.payload.provider_key).toBe("fake-cli");
      expect(j.payload.step_index).toBe(0);
      expect(j.payload.profile_steps).toEqual([s("fake-cli")]);
    } finally {
      await resetStates();
    }
  });

  it("HUB-FR-67 · AC-H4b2-07 · D02 · claude-sub logged_out + on [error] ⇒ job ở fake-cli; log job.fallback có đích fake-cli", async () => {
    await configure([s("claude-sub", ["error"]), s("fake-cli")]);
    await state("claude-sub", "logged_out");
    const from = log.lines.length;
    try {
      expect((await firstJob("Câu D02")).provider_key).toBe("fake-cli");
      const lines = log.lines.slice(from).filter((l) => l.includes("job.fallback"));
      expect(lines.length).toBeGreaterThanOrEqual(1);
      expect(lines.join("\n")).toContain("fake-cli");
    } finally {
      await resetStates();
    }
  });

  it("HUB-FR-67 · AC-H4b2-07 · D03 · claude-sub cooldown + on [] ⇒ run.failed ALL_PROVIDERS_EXHAUSTED, không job (không thử bước kế)", async () => {
    await configure([s("claude-sub"), s("fake-cli")]);
    await state("claude-sub", "cooldown", FUT);
    try {
      await failsExhausted("Câu D03");
    } finally {
      await resetStates();
    }
  });

  it("HUB-FR-67 · AC-H4b2-07 · D04 · claude-sub TẮT (enabled false), on [] ⇒ bỏ qua vô điều kiện ⇒ job ở fake-cli", async () => {
    await configure([s("claude-sub"), s("fake-cli")], false);
    try {
      expect((await firstJob("Câu D04")).provider_key).toBe("fake-cli");
    } finally {
      await configure([s("fake-cli")], true);
    }
  });

  it("HUB-FR-67 · AC-H4b2-07 · D05 · không chặn ⇒ bước 0 (claude-sub) như cũ; payload profile_steps = [claude-sub]", async () => {
    await configure([s("claude-sub", ["quota"]), s("fake-cli")]);
    const j = await firstJob("Câu D05");
    expect(j.provider_key).toBe("claude-sub");
    expect(j.payload.profile_steps).toEqual([s("claude-sub", ["quota"])]);
  });

  it("HUB-FR-67 · AC-H4b2-07 · D06 · cả hai bước cooldown, on [quota] ⇒ run.failed ALL_PROVIDERS_EXHAUSTED, không job", async () => {
    await configure([s("claude-sub", ["quota"]), s("fake-cli", ["quota"])]);
    await state("claude-sub", "cooldown", FUT);
    await state("fake-cli", "cooldown", FUT);
    try {
      await failsExhausted("Câu D06");
    } finally {
      await resetStates();
    }
  });

  it("HUB-FR-67 · AC-H4b2-07 · D07 · Studio active_step khớp nơi giao job (D10): cùng cấu hình D01 ⇒ active_step 1", async () => {
    await configure([s("claude-sub", ["quota"]), s("fake-cli")]);
    await state("claude-sub", "cooldown", FUT);
    try {
      const r = await call(hub, "GET", "/studio/api/model-profiles", {
        token: await sign(k, USERS.padmin),
      });
      const it1 = r.json?.items?.find((i: Json) => i.key === "fake-1");
      expect(it1?.active_step).toBe(1);
      expect((await firstJob("Câu D07")).provider_key).toBe("fake-cli");
    } finally {
      await resetStates();
      await configure([s("fake-cli")], true);
    }
  });
});

describe("D08–D09 · agent có model riêng ⇒ không dự phòng [Q4 chốt · AC-H4b2-07]", () => {
  const ORCH = "orchestrator";
  async function setAgentModel(model: string | null) {
    await sql`update hub.agents set model = ${model} where key = ${ORCH}`;
  }
  it("HUB-FR-67 · AC-H4b2-07 · D08 · agent.model = 'haiku', bước 0 (claude-sub) TẮT, bước 1 fake-cli ok ⇒ run.failed ALL_PROVIDERS_EXHAUSTED, không job, không log job.fallback", async () => {
    await setAgentModel("haiku");
    await configure([s("claude-sub"), s("fake-cli")], false);
    const from = log.lines.length;
    try {
      await failsExhausted("Câu D08");
      expect(log.lines.slice(from).some((l) => l.includes("job.fallback"))).toBe(false);
    } finally {
      await setAgentModel(null);
      await configure([s("fake-cli")], true);
    }
  });

  it("HUB-FR-67 · AC-H4b2-07 · D09 · agent.model = 'haiku', bước 0 ok ⇒ job ở bước 0; payload.model = 'haiku' (agent.model thắng step.model)", async () => {
    await setAgentModel("haiku");
    await configure([{ provider_key: "claude-sub", model: "opus", on: ["quota"] }, s("fake-cli")]);
    try {
      const j = await firstJob("Câu D09");
      expect(j.provider_key).toBe("claude-sub");
      expect(j.payload.model).toBe("haiku");
    } finally {
      await setAgentModel(null);
      await configure([s("fake-cli")], true);
    }
  });
});
