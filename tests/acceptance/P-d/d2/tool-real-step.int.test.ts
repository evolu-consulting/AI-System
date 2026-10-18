// AC-H44 · HUB-FR-146 · HUB-BR-12 · D2-49 · TECH-DEBT #204 (hướng A) · test-plan-d2 §3.1 PD2-I60…I62: lưu def có stage `tool`
// `real_action` ở bước 0 / sau bước có stage `auto` bị chặn NGAY (422 `PROCESS_DEF_INVALID` rules ∋ `REAL_ACTION`, path
// `stages.<i>.real_action`) — không để tới lúc chạy mới `tool_failed` (PD2-I57). Sau bước toàn `review` ⇒ lưu được.
// Hub thật + seed workflow như `tool.int.test.ts`; thiếu 0012/0037/contract ⇒ đỏ NGAY ở `needD2`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { agentStage, createDef, defBody, G1, type Json } from "../_support/pd";
import {
  ACME,
  type CtxD2,
  insertWorkflows,
  MA_KH_INPUT,
  needD2,
  setSwitch,
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
const REVIEW = { kind: "review", group_id: G1, back_to_steps: [] };
/** Tham số không cần stage trước (bước 0 không có nguồn field). */
const ARGS0 = {
  tong_tien: { from: "const", value: 25_000_000 },
  ma_kh: { from: "input", key: "ma-kh" },
};
let seq = 0;
let ready = false;
async function prep(): Promise<void> {
  await needD2(c);
  if (!ready) {
    await insertWorkflows(c.sql, c.dify.baseUrl);
    for (const w of ["W", "WS"] as const) await setSwitch(c.sql, w, ACME, true);
    ready = true;
  }
}
const body = (stages: Json[]) => defBody(`pd2-real-${++seq}`, stages, { inputs: MA_KH_INPUT });
const post = (stages: Json[]) => c.call("Adm", "POST", "/process-defs", body(stages));
const shape = (r: Json) => ({
  status: r.status,
  code: r.json?.error?.code,
  rules: r.json?.error?.details?.rules,
  paths: r.json?.error?.details?.paths,
});
const realRejected = (path: string) => ({
  status: 422,
  code: "PROCESS_DEF_INVALID",
  rules: expect.arrayContaining(["REAL_ACTION"]),
  paths: expect.arrayContaining([path]),
});

describe("AC-H44 · #204 · lưu def stage tool real_action theo bước trước", () => {
  it("HUB-BR-12 · PD2-I60 · tool real_action ở bước 0 ⇒ 422 PROCESS_DEF_INVALID REAL_ACTION stages.0.real_action (POST và PUT)", async () => {
    await prep();
    for (const k of [WF.W.key, WF.WS.key]) {
      const r = await post([
        toolStage({ key: "s0", step: 0, tool_key: k, args: ARGS0, real_action: true }),
      ]);
      expect(shape(r)).toEqual(realRejected("stages.0.real_action"));
    }
    // PUT def hợp lệ thành tool real ở bước 0 ⇒ cũng 422.
    const def = await createDef(c, body([agentStage({ key: "s0", step: 0 })]));
    const put = await c.call("Adm", "PUT", `/process-defs/${def.id}`, {
      ...defBody(
        def.key as string,
        [toolStage({ key: "s0", step: 0, tool_key: WF.WS.key, args: ARGS0, real_action: true })],
        { inputs: MA_KH_INPUT },
      ),
      version: def.version,
    });
    expect(shape(put)).toEqual(realRejected("stages.0.real_action"));
  }, 30_000);

  it("HUB-BR-12 · PD2-I61 · tool real_action ở bước 1 sau s0 `auto` ⇒ 422 REAL_ACTION stages.1.real_action", async () => {
    await prep();
    const r = await post([
      agentStage({ key: "s0", step: 0, fields: FIELDS, after: { kind: "auto" } }),
      toolStage({ tool_key: WF.WS.key, real_action: true }),
    ]);
    expect(shape(r)).toEqual(realRejected("stages.1.real_action"));
  }, 30_000);

  it("HUB-BR-12 · PD2-I62 · tool real_action ở bước 1 sau s0 `review` ⇒ POST 201, PUT 200", async () => {
    await prep();
    const stages = [
      agentStage({ key: "s0", step: 0, fields: FIELDS, after: REVIEW }),
      toolStage({ tool_key: WF.WS.key, real_action: true }),
    ];
    const b = body(stages);
    const r = await c.call("Adm", "POST", "/process-defs", b);
    expect({ status: r.status, real: r.json?.stages?.[1]?.real_action }).toEqual({
      status: 201,
      real: true,
    });
    const put = await c.call("Adm", "PUT", `/process-defs/${r.json?.id}`, {
      ...b,
      version: r.json?.version,
    });
    expect(put.status).toBe(200);
  }, 30_000);
});
