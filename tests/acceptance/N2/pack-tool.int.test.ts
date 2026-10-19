// N2-FR-03 · N2-AC06…AC08 · tool của gói (`pkdemo-touch` không side_effect, `pkdemo-mark` side_effect) gọi từ stage `tool`:
// chạy trong tx gói của ĐÚNG tenant run (RLS `pkdemo_rw`), giữ kiểm P-d2 (gói bật = công tắc, D2-49 side_effect ⇒ real_action),
// tenant chưa bật gói không lưu được def. Chờ bằng `handles.settled()` (không ngủ).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  createDef,
  decisionOf,
  defBody,
  type Json,
  PA,
  startRun,
  waitStatus,
} from "../P-d/_support/pd";
import { settled, toolStage } from "../P-d/d2/_d2";
import {
  ACME,
  BETA,
  type CtxN2,
  disablePk,
  enablePk,
  errCode,
  startN2,
  untilPkActions,
} from "./_n2";

let c: CtxN2;
beforeAll(async () => {
  c = await startN2({ processRunsPerTenant: 200 });
  await enablePk(c, ACME, [PA.A]);
  await untilPkActions(c, "A", ["read", "write"]);
}, 90_000);
afterAll(async () => {
  await c?.stop();
});

const TEN = [{ key: "ten", type: "text", label: "Tên", required: true }];
const FIELDS = [
  { key: "item_id", type: "string", required: true },
  { key: "title", type: "string", required: true },
];
let seq = 0;
function packDef(tool: string, o: Json = {}): Json {
  return defBody(
    `n2-pt-${++seq}`,
    [
      toolStage({
        key: "s0",
        step: 0,
        tool_key: tool,
        args: { title: { from: "input", key: "ten" } },
        fields: FIELDS,
        real_action: o.real_action ?? false,
      }),
    ],
    { inputs: TEN },
  );
}
const items = (title: string) =>
  c.sql<Json[]>`select id, tenant_id from pkdemo.items where title = ${title}`;

describe("N2-AC06…08 · tool gói trong stage tool [N2-FR-03]", () => {
  it("N2-AC06 · stage gọi pkdemo-touch ⇒ hàng pkdemo của tenant run, output fields, run done; audit tool_call", async () => {
    const d = await createDef(c, packDef("pkdemo-touch"));
    const runId = await startRun(c, d.key, {
      inputs: [{ key: "ten", type: "text", text: "N2 mục 1" }],
    });
    await settled(c);
    await waitStatus(c.sql, runId, "done");
    const rows = await items("N2 mục 1");
    expect(rows.map((r) => r.tenant_id)).toEqual([ACME]);
    const [out] = await c.sql<
      Json[]
    >`select fields from hub.process_outputs where process_run_id = ${runId}`;
    expect(out?.fields).toEqual({ item_id: rows[0]?.id, title: "N2 mục 1" });
    const [a] = await c.sql<Json[]>`select entity_name from hub.audit_log where action = 'tool_call'
      and entity_id = ${runId}`;
    expect(a?.entity_name).toBe("pkdemo-touch");
  }, 60_000);

  it("N2-AC07 · beta chưa bật gói ⇒ lưu def 422 PROCESS_REF_INVALID (ref tool)", async () => {
    const r = await c.call("Db", "POST", "/process-defs", packDef("pkdemo-touch"));
    expect({ status: r.status, code: errCode(r) }).toEqual({
      status: 422,
      code: "PROCESS_REF_INVALID",
    });
    expect(r.json?.error?.details?.ref).toBe("tool");
    expect(BETA).toBeTruthy();
  });

  it("N2-AC08 · tool side_effect ở stage không real_action ⇒ 422 (TOOL_SIDE_EFFECT)", async () => {
    const r = await c.call("Adm", "POST", "/process-defs", packDef("pkdemo-mark"));
    expect({ status: r.status, code: errCode(r) }).toEqual({
      status: 422,
      code: "PROCESS_DEF_INVALID",
    });
    expect(r.json?.error?.details?.rules ?? []).toContain("TOOL_SIDE_EFFECT");
  });

  it("N2-AC08 · đường CHẠY (D2-49): snapshot trỏ pkdemo-mark (side_effect) ở stage không real_action ⇒ needs_decision tool_failed, 0 hàng", async () => {
    const d = await createDef(c, packDef("pkdemo-touch"));
    // Def cũ / sửa tay qua luật lưu: chỉ đường chạy còn chặn.
    await c.sql`update hub.process_defs set stages = jsonb_set(stages, '{0,executor,tool_key}', '"pkdemo-mark"')
      where key = ${d.key}`;
    const runId = await startRun(c, d.key, {
      inputs: [{ key: "ten", type: "text", text: "N2 mark lậu" }],
    });
    await settled(c);
    await waitStatus(c.sql, runId, "needs_decision");
    expect((await decisionOf(c.sql, runId))?.reason).toBe("tool_failed");
    expect(await items("N2 mark lậu")).toEqual([]);
  }, 60_000);

  it("security M2 · người bắt đầu không có quyền write gói (X) ⇒ needs_decision permission_lost, 0 hàng", async () => {
    const d = await createDef(c, packDef("pkdemo-touch"));
    const runId = await startRun(c, d.key, {
      role: "X",
      inputs: [{ key: "ten", type: "text", text: "N2 không quyền" }],
    });
    await settled(c);
    await waitStatus(c.sql, runId, "needs_decision");
    expect((await decisionOf(c.sql, runId))?.reason).toBe("permission_lost");
    expect(await items("N2 không quyền")).toEqual([]);
  }, 60_000);

  it("N2-AC07 · gói tắt SAU khi lưu def ⇒ needs_decision tool_failed, 0 hàng gói mới", async () => {
    const d = await createDef(c, packDef("pkdemo-touch"));
    await disablePk(c, ACME);
    await untilPkActions(c, "A", []);
    const runId = await startRun(c, d.key, {
      inputs: [{ key: "ten", type: "text", text: "N2 tắt" }],
    });
    await settled(c);
    await waitStatus(c.sql, runId, "needs_decision");
    expect((await decisionOf(c.sql, runId))?.reason).toBe("tool_failed");
    expect(await items("N2 tắt")).toEqual([]);
  }, 60_000);
});
