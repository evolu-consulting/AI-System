// CR-118 · cr118-form-node · int: node `form` qua Hub thật — task cho Group của bước; ma trận người làm (thành viên Group ok,
// member khác / tenant khác / đối tác ở run gói contracts ⇒ 404); gửi lại cùng giá trị ⇒ cùng kết quả (một output, một
// audit); giá trị kiểm theo SNAPSHOT (def sửa sau khi run bắt đầu không ảnh hưởng); If bước sau đọc field; audit hàng.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { sign, T as T_FIX } from "../H1/_fixtures";
import { PA } from "../P-a/_support/pa";
import {
  agentStage,
  type CtxPd,
  createDef,
  defBody,
  G1,
  type Json,
  startPd,
  startRun,
  waitStageStatus,
  waitStatus,
} from "../P-d/_support/pd";
import { stageOutputs } from "../P-d/d1/_wait";
import { settled } from "../P-d/d2/_d2";
import { api } from "../X2a/_x2a";

let c: CtxPd;
beforeAll(async () => {
  c = await startPd();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const FORM_FIELDS = [
  { key: "so_tien", label: "Số tiền", type: "money", required: true },
  { key: "ghi_chu", label: "Ghi chú", type: "text", max_len: 50 },
];
const formStage = (key: string, step: number, fields: Json[] = FORM_FIELDS): Json => ({
  ...agentStage({ key, step, executor: { kind: "form", fields } }),
  instruction: "",
  output: {
    filename: `${key}.md`,
    template: "# x\n\n## Kết quả\n",
    required_sections: ["Kết quả"],
    // Khớp trường form (FORM_INVALID nếu lệch); Hub ép `required: false` khi lưu.
    fields: fields.map((f) => ({
      key: f.key,
      type: OUT_TYPE[f.type] ?? "string",
      required: false,
    })),
  },
  after: { kind: "review", group_id: G1, back_to_steps: [] },
});
const OUT_TYPE: Record<string, string> = { money: "number", number: "number", date: "date" };
const setStage = (key: string, step: number): Json => ({
  ...agentStage({
    key,
    step,
    executor: { kind: "set", values: [{ key: "ket", from: { const: key } }] },
  }),
  instruction: "",
  output: {
    filename: `${key}.md`,
    template: `# ${key}\n\n## Kết quả\n`,
    required_sections: ["Kết quả"],
    fields: [{ key: "ket", type: "string", required: true }],
  },
});
const ifStage = (key: string, step: number): Json =>
  agentStage({
    key,
    step,
    executor: {
      kind: "if",
      when: {
        op: "and",
        conds: [
          { from: { kind: "field", stage_key: "dien", field: "so_tien" }, op: "gt", value: 100 },
        ],
      },
      then_step: 3,
      else_step: null,
    },
    output: {
      filename: `${key}.md`,
      template: `# ${key}\n\n## Bàn giao\n`,
      required_sections: ["Bàn giao"],
      fields: [],
    },
  });

let seq = 0;
async function formRun(): Promise<{ runId: string; taskId: string; key: string; def: Json }> {
  const key = `cr118-form-${++seq}`;
  const body = defBody(key, [
    formStage("dien", 0),
    ifStage("kiem", 1),
    setStage("nho", 2),
    setStage("lon", 3),
  ]);
  const def = await createDef(c, body);
  const runId = await startRun(c, key);
  await waitStageStatus(c, runId, 0, "waiting_review");
  const [t] = await c.sql<Json[]>`select id from hub.review_tasks where process_run_id = ${runId}
    and kind = 'review' and status = 'open' limit 1`;
  expect(t?.id).toBeTruthy();
  return { runId, taskId: String(t?.id), key, def: { ...def, body } };
}
const submit = (r: "B" | "T" | "X" | "Db", taskId: string, values: Json) =>
  c.call(r, "POST", `/review-tasks/${taskId}/form`, { values });

describe("CR-118 · node form", () => {
  it("ma trận người làm: member ngoài Group / tenant khác / đối tác (run gói contracts) ⇒ 404, thành viên Group ⇒ 200", async () => {
    const { runId, taskId } = await formRun();
    const ok = { so_tien: 500, ghi_chu: "x" };
    expect((await submit("X", taskId, ok)).status).toBe(404); // tam: member acme, ngoài Group Kế toán
    expect((await submit("Db", taskId, ok)).status).toBe(404); // tadmin_beta: tenant khác
    // Quyết thường (decision) trên task form ⇒ 409 TASK_KIND_MISMATCH (chỉ quyết qua form).
    const d = await c.call("B", "POST", `/review-tasks/${taskId}/decision`, { result: "pass" });
    expect({ s: d.status, code: d.json?.error?.code }).toEqual({
      s: 409,
      code: "TASK_KIND_MISMATCH",
    });
    expect((await submit("B", taskId, ok)).status).toBe(200);
    await settled(c);
    await waitStageStatus(c, runId, 0, "done");
    // Đối tác: cuc (thuộc Group) nhưng token user ngoài, run gắn gói contracts ⇒ không bao giờ làm bước.
    const r2 = await formRun();
    await c.sql`update hub.process_runs set pack_key = 'contracts', pack_record_id = gen_random_uuid()
      where id = ${r2.runId}`;
    const ext = await sign(c.k, PA.T, {
      claims: {
        tid: PA.T.tid,
        role: PA.T.role,
        sid: null,
        kind: "external",
        xorg: "a5a00000-0000-4000-8000-000000009001",
      },
    });
    const p = await api(c.hub, ext, "POST", `/review-tasks/${r2.taskId}/form`, { values: ok });
    // 403 = chặn user ngoài ở tầng route (có sẵn); 404 = chặn của node form (`assertFormActor`, unit form-out.test).
    expect([403, 404]).toContain(p.status);
    const [t2] = await c.sql<Json[]>`select status from hub.review_tasks where id = ${r2.taskId}`;
    expect(t2?.status).toBe("open");
  }, 60_000);

  it("giá trị sai ⇒ 422 FORM_VALUES_INVALID {paths}, task vẫn mở, output không đổi", async () => {
    const { runId, taskId } = await formRun();
    const res = await submit("B", taskId, { so_tien: -5, ghi_chu: "x".repeat(51) });
    expect({ s: res.status, code: res.json?.error?.code, d: res.json?.error?.details }).toEqual({
      s: 422,
      code: "FORM_VALUES_INVALID",
      d: { paths: ["so_tien", "ghi_chu"] },
    });
    const [t] = await c.sql<Json[]>`select status from hub.review_tasks where id = ${taskId}`;
    expect(t?.status).toBe("open");
    const [o] = await stageOutputs(c.sql, runId, 0);
    expect(Object.keys(o?.fields ?? {})).toEqual([]);
  }, 60_000);

  it("idempotent: gửi 2 lần cùng giá trị ⇒ 200 cả hai, một output, một audit, giá trị khác sau khi đóng ⇒ 409", async () => {
    const { runId, taskId } = await formRun();
    const v = { so_tien: 500, ghi_chu: "lần 1", la: "<b>bỏ</b>" };
    const [a, b] = [await submit("B", taskId, v), await submit("T", taskId, v)];
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(b.json?.id ?? b.json?.task_id).toBe(a.json?.id ?? a.json?.task_id);
    const diff = await submit("B", taskId, { so_tien: 501 });
    expect({ s: diff.status, code: diff.json?.error?.code }).toEqual({
      s: 409,
      code: "REVIEW_TASK_CLOSED",
    });
    await settled(c);
    const outs = await stageOutputs(c.sql, runId, 0);
    expect(outs.length).toBe(1);
    expect(outs[0]?.fields).toEqual({ so_tien: 500, ghi_chu: "lần 1" });
    const audits = await c.sql<Json[]>`select actor_id, action, entity, after from hub.audit_log
      where entity = 'review_task' and entity_id = ${taskId}`;
    expect(audits.length).toBe(1);
    expect(audits[0]).toMatchObject({ actor_id: PA.B.id, action: "review", entity: "review_task" });
    expect(audits[0]?.after).toEqual({ kind: "form", stage_idx: 0, keys: ["so_tien", "ghi_chu"] });
    const [t] = await c.sql<
      Json[]
    >`select result, decided_by from hub.review_tasks where id = ${taskId}`;
    expect(t).toEqual({ result: "pass", decided_by: PA.B.id });
  }, 60_000);

  it("If bước sau đọc field form: so_tien > 100 ⇒ nhảy bước 3 (bước 2 skipped), run done", async () => {
    const { runId, taskId } = await formRun();
    expect((await submit("B", taskId, { so_tien: 250 })).status).toBe(200);
    await settled(c);
    await waitStageStatus(c, runId, 3, "done");
    await waitStatus(c.sql, runId, "done");
    const [s2] = await c.sql<
      Json[]
    >`select status from hub.stage_runs where process_run_id = ${runId} and stage_idx = 2`;
    expect(s2?.status).toBe("skipped");
  }, 60_000);

  it("snapshot: def sửa sau khi run bắt đầu (đổi trường) ⇒ run cũ vẫn kiểm theo form lúc bắt đầu", async () => {
    const { runId, taskId, def } = await formRun();
    const v2 = {
      ...def.body,
      version: def.version,
      stages: [
        formStage("dien", 0, [
          { key: "so_tien", label: "Số tiền", type: "money", required: true, max: 10 },
          { key: "ly_do", label: "Lý do", type: "textarea", required: true },
        ]),
        ...def.body.stages.slice(1),
      ],
    };
    const up = await c.call("P", "PUT", `/process-defs/${def.id}?tenant_id=${T_FIX.acme}`, v2);
    expect(up.status).toBe(200);
    // Theo def MỚI thì thiếu `ly_do` (bắt buộc) và `so_tien` > 10 — run cũ vẫn theo snapshot ⇒ hợp lệ.
    expect((await submit("B", taskId, { so_tien: 50 })).status).toBe(200);
    await settled(c);
    const [o] = await stageOutputs(c.sql, runId, 0);
    expect(o?.fields).toEqual({ so_tien: 50 });
    await waitStatus(c.sql, runId, "done");
  }, 60_000);
});
