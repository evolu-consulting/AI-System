// AC-H47 · HUB-FR-146 · TT-R04…R08 · plan-d2 §10 S2/S9/S10 (hard stop) · test-plan-d2 §3.2 PD2-I20…I27 + I15 (I15/I22/I27: T15b): công tắc tool theo tenant +
// cách ly 2 tenant. `hub_ro` policy `USING (true)` ⇒ lọc `tenant_id = run.tenant_id` tường minh là rào DUY NHẤT: bật ở beta,
// chạy ở acme ⇒ `tool_failed`, Dify 0 lời gọi. Kiểm `canRun` NGAY trước gọi (S10). Chờ tool-driver bằng `handles.settled()`.
// Thiếu 0012/0037/contract ⇒ đỏ NGAY ở `needD2` ("chưa có tính năng: … (T17|T18a)").
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  agentStage,
  createDef,
  decisionOf,
  defBody,
  jobDone,
  mdOut,
  nextStageJob,
  openTimers,
  PA,
  SEC,
  startRun,
  sweepN,
  waitStageStatus,
} from "../_support/pd";
import {
  ACME,
  BETA,
  type CtxD2,
  insertWorkflows,
  MA_KH_INPUT,
  needD2,
  setSwitch,
  settled,
  startD2,
  toolStage,
  WF,
} from "./_d2";

let c: CtxD2;
beforeAll(async () => {
  c = await startD2();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const FIELDS = [{ key: "tong_tien", type: "number", required: true }];
let seq = 0;
/** Def acme s0 agent (fields tong_tien) → s1 tool W; trả key. */
async function toolDef(tool_key: string = WF.W.key, role: "Adm" = "Adm"): Promise<string> {
  const key = `pd2-sw-${++seq}`;
  await createDef(
    c,
    defBody(key, [agentStage({ key: "s0", step: 0, fields: FIELDS }), toolStage({ tool_key })], {
      inputs: MA_KH_INPUT,
    }),
    role,
  );
  return key;
}
/** Chạy tới khi s0 xong (tool-driver đã xử lý xong s1 — tín hiệu `settled`). */
async function runToTool(key: string, beforeS0Done?: () => Promise<void>): Promise<string> {
  const runId = await startRun(c, key, { inputs: [{ type: "text", key: "ma-kh", text: "KH1" }] });
  const job = await nextStageJob(c, runId);
  await beforeS0Done?.();
  await jobDone(c, job, mdOut({ tong_tien: 25_000_000 }));
  await waitStageStatus(c, runId, 0, "done");
  await settled(c);
  return runId;
}
/** Tool nen tang (guide/my-history) hien o moi tenant, khong theo cong tac workflow => loai khoi so sanh catalog workflow. */
const PLATFORM_TOOLS = new Set(["app-guide", "my-activity", "my-chat-history"]);
const toolKeys = (json: { tools?: { key: string }[] } | null | undefined): string[] =>
  (json?.tools ?? []).map((t) => t.key).filter((k) => !PLATFORM_TOOLS.has(k));
async function prep(): Promise<void> {
  await needD2(c);
  await insertWorkflows(c.sql, c.dify.baseUrl);
  c.dify.calls.length = 0;
}

describe("AC-H47 · catalog + lưu def theo tenant [TT-R04]", () => {
  it("AC-H47 · PD2-I20 · W bật acme, chưa bật beta ⇒ editor acme thấy W, beta không; beta lưu def dùng W ⇒ 422 PROCESS_REF_INVALID", async () => {
    await prep();
    await setSwitch(c.sql, "W", ACME, true);
    const a = await c.call("Adm", "GET", "/process-editor/context");
    expect(toolKeys(a.json)).toEqual([WF.W.key]);
    const b = await c.call("Db", "GET", "/process-editor/context");
    expect(toolKeys(b.json)).toEqual([]);
    const res = await c.call(
      "Db",
      "POST",
      "/process-defs",
      // Chỉ stage tool (args const): agent của acme không tồn tại ở beta sẽ báo `ref: agent` trước, che lỗi cần kiểm.
      defBody(
        "pd2-beta",
        [
          toolStage({
            key: "s0",
            step: 0,
            args: {
              tong_tien: { from: "const", value: 25_000_000 },
              ma_kh: { from: "const", value: "KH1" },
            },
          }),
        ],
        { inputs: MA_KH_INPUT },
      ),
    );
    expect({
      status: res.status,
      code: res.json?.error?.code,
      ref: res.json?.error?.details?.ref,
    }).toEqual({
      status: 422,
      code: "PROCESS_REF_INVALID",
      ref: "tool",
    });
  }, 30_000);
});

describe("AC-H47 · S9 · cách ly 2 tenant — lọc tenant_id tường minh (hub_ro USING(true))", () => {
  it("AC-H47 · PD2-I21 · run acme ở s0 ⇒ tắt W cho acme ⇒ s1 needs_decision tool_failed, Dify 0 lời gọi", async () => {
    await prep();
    await setSwitch(c.sql, "W", ACME, true);
    const key = await toolDef();
    const runId = await runToTool(key, () => setSwitch(c.sql, "W", ACME, false));
    expect((await decisionOf(c.sql, runId))?.reason).toBe("tool_failed");
    expect(c.dify.calls).toHaveLength(0);
  }, 30_000);
  it("AC-H47 · PD2-I23 · S9 · W tắt ở acme, BẬT ở beta ⇒ run acme mới vẫn tool_failed, Dify 0 lời gọi (công tắc đọc theo run.tenant_id)", async () => {
    await prep();
    await setSwitch(c.sql, "W", ACME, true);
    const key = await toolDef();
    await setSwitch(c.sql, "W", ACME, false);
    await setSwitch(c.sql, "W", BETA, true);
    const runId = await runToTool(key);
    expect((await decisionOf(c.sql, runId))?.reason).toBe("tool_failed");
    expect(c.dify.calls).toHaveLength(0);
  }, 30_000);
  it("AC-H47 · PD2-I24 · admin.workflows.enabled=false khi run chờ ⇒ tool_failed, 0 lời gọi", async () => {
    await prep();
    await setSwitch(c.sql, "W", ACME, true);
    const key = await toolDef();
    const runId = await runToTool(key, async () => {
      await c.sql`update admin.workflows set enabled = false where id = ${WF.W.id}`;
    });
    await c.sql`update admin.workflows set enabled = true where id = ${WF.W.id}`;
    expect((await decisionOf(c.sql, runId))?.reason).toBe("tool_failed");
    expect(c.dify.calls).toHaveLength(0);
  }, 30_000);
});

describe("AC-H47 · S10 · quyền chạy kiểm ngay trước gọi [PD2-R03, L7]", () => {
  it("AC-H47 · PD2-I25 · người bắt đầu không có agent grant, thuộc Group chạy ⇒ Dify 1 lời gọi bằng difyUser của người bắt đầu", async () => {
    await prep();
    await setSwitch(c.sql, "W", ACME, true);
    const key = await toolDef();
    const runId = await runToTool(key);
    expect(c.dify.calls).toHaveLength(1);
    expect(c.dify.calls[0]?.user).toContain(PA.A.id);
    expect(c.dify.calls[0]?.inputs).toEqual({ tong_tien: 25_000_000, ma_kh: "KH1" });
    expect(await decisionOf(c.sql, runId)).toBeUndefined();
  }, 30_000);
  it("AC-H47 · PD2-I26 · thu hồi Group chạy quy trình của A khi run ở s0 ⇒ permission_lost, 0 lời gọi", async () => {
    await prep();
    await setSwitch(c.sql, "W", ACME, true);
    const key = await toolDef();
    const runId = await runToTool(key, async () => {
      await c.sql`update hub.process_defs set run_group_ids = ${c.sql.array([WF.WOFF.id])}::uuid[] where key = ${key}`;
    });
    expect((await decisionOf(c.sql, runId))?.reason).toBe("permission_lost");
    expect(c.dify.calls).toHaveLength(0);
  }, 30_000);
});

describe("AC-H47 · TT-R07 · công tắc đọc lại mỗi lần gọi, không huỷ lời gọi đã gửi (T15b)", () => {
  it("AC-H47 · PD2-I22 · W 503 ⇒ s1 backoff retry ⇒ tắt W cho acme ⇒ bắn hẹn ⇒ tool_failed, 0 lời gọi mới", async () => {
    await prep();
    await setSwitch(c.sql, "W", ACME, true);
    const key = await toolDef();
    c.dify.script([{ kind: "http", status: 503 }]);
    const runId = await runToTool(key);
    expect({ calls: c.dify.calls.length, timers: (await openTimers(c.sql, runId)).length }).toEqual(
      { calls: 1, timers: 1 },
    );
    await setSwitch(c.sql, "W", ACME, false);
    c.clk.advance(31 * SEC);
    await sweepN(c, 1);
    await settled(c);
    expect((await decisionOf(c.sql, runId))?.reason).toBe("tool_failed");
    expect(c.dify.calls).toHaveLength(1);
  }, 30_000);
  it("AC-H47 · PD2-I27 · lời gọi đang bay (fake giữ tới khi nhả) khi tắt W ⇒ lời gọi hoàn tất, s1 done", async () => {
    await prep();
    await setSwitch(c.sql, "W", ACME, true);
    const key = await toolDef();
    let release = () => {};
    const until = new Promise<void>((ok) => {
      release = ok;
    });
    c.dify.script([{ kind: "hold", until, result: { so_hd: "HD-1" } }]);
    const runId = await startRun(c, key, {
      inputs: [{ type: "text", key: "ma-kh", text: "KH1" }],
    });
    await jobDone(c, await nextStageJob(c, runId), mdOut({ tong_tien: 25_000_000 }));
    await waitStageStatus(c, runId, 0, "done");
    try {
      await c.dify.arrived(1, () => settled(c));
      await setSwitch(c.sql, "W", ACME, false);
    } finally {
      release();
    }
    await settled(c);
    expect(c.dify.calls).toHaveLength(1);
    await waitStageStatus(c, runId, 1, "done", 0);
    expect(await decisionOf(c.sql, runId)).toBeUndefined();
  }, 30_000);
});

describe("AC-H47 · TT-R04 · catalog editor theo tenant (T15b)", () => {
  it("AC-H47 · PD2-I15 · W bật acme (WS tắt, WOFF enabled=false bật) ⇒ GET /process-editor/context tools acme [W], beta [], padmin mẫu []", async () => {
    await prep();
    await setSwitch(c.sql, "W", ACME, true);
    await setSwitch(c.sql, "WS", ACME, false);
    await setSwitch(c.sql, "WOFF", ACME, true);
    await setSwitch(c.sql, "W", BETA, false);
    const keys = async (r: "Adm" | "Db" | "P") => {
      const res = await c.call(r, "GET", "/process-editor/context");
      expect({ role: r, status: res.status }).toEqual({ role: r, status: 200 });
      return toolKeys(res.json);
    };
    expect({ acme: await keys("Adm"), beta: await keys("Db"), mau: await keys("P") }).toEqual({
      acme: [WF.W.key],
      beta: [],
      mau: [],
    });
  }, 30_000);
});
