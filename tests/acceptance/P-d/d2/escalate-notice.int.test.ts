// AC-H42 · HUB-FR-145 · D2-47 (#115) · test-plan-d2 §3.4b PD2-I51: notice `escalated` mang `group` + `after_h` (payload ghi trong
// CÙNG câu chèn notice — PD-P15 giữ số câu), history `escalate` có `after_h`. Dùng gate nhắc của P-d1 (`_remind`): task review
// G1 → chuyển cấp sang G2 sau 24 h, đồng hồ lệch + `remindOnce`. Đỏ vì chưa có `group`/`after_h` trong payload/inbox/history.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  type CtxPd,
  type Json,
  needPdSchema,
  PA,
  PD,
  PD_DEFS,
  startPd,
  T,
  viewRun,
} from "../_support/pd";
import { ensureDef, escalateAll, remindGate } from "../d1/_remind";

let c: CtxPd;
beforeAll(async () => {
  c = await startPd({ processRunsPerTenant: 200 });
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

describe("AC-H42 · D2-47 · notice chuyển cấp có Group + sau bao nhiêu giờ", () => {
  it("AC-H42 · PD2-I51 · chuyển cấp sau 24 h ⇒ payload + inbox notice escalated có group {id G2} + after_h 24; history escalate có after_h 24", async () => {
    needPdSchema(c.pd);
    await ensureDef(c, PD_DEFS.remind());
    const g = await remindGate(c);
    await escalateAll(c, [g]);
    const [n] = await c.sql<Json[]>`select id, payload, tenant_id from hub.process_notices
      where task_id = ${g.task.id} and kind = 'escalated' and user_id = ${PA.H.id}`;
    expect({ tenant: n?.tenant_id }).toEqual({ tenant: T.acme });
    expect({ group: n?.payload?.group?.id, after_h: n?.payload?.after_h }).toEqual({
      group: PD.gG2,
      after_h: 24,
    });
    const inbox = await c.call("H", "GET", "/me/process-inbox");
    expect(inbox.status).toBe(200);
    const item = (inbox.json?.items ?? []).find((i: Json) => i.id === n?.id);
    expect({ group: item?.group?.id, after_h: item?.after_h }).toEqual({
      group: PD.gG2,
      after_h: 24,
    });
    const view = await viewRun(c, "A", g.runId);
    expect(view.status).toBe(200);
    const esc = (view.json?.history ?? []).filter((h: Json) => h.kind === "escalate");
    expect(esc.map((h: Json) => ({ group: h.group?.id, after_h: h.after_h }))).toEqual([
      { group: PD.gG2, after_h: 24 },
    ]);
  }, 60_000);
});
