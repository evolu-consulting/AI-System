// CR-121 D-6 · node `notify` + `wait_until` (khuôn bước Chờ tới của khe duyệt HĐ) trên hub THẬT (đồng hồ lệch, `sweepOnce`):
// (1) notify sau bước duyệt: Đạt ⇒ gửi đúng người (người bắt đầu + Group theo mã), xong bước, run tới done;
// (2) ghi 2 lần đua cùng khoá (run, stage run, lần thử) ⇒ đúng 1 thông báo mỗi người;
// (3) người nhận rỗng ⇒ bước vẫn xong, .md "Cảnh báo";
// (4) chặn chéo công ty: user công ty khác ở input người phụ trách ⇒ không nhận;
// (5) bước Chờ tới của khe (`waitExecutorOf`) hẹn giờ theo ngày HĐ, tới hạn ⇒ chạy tiếp tới bước Thông báo.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { waitExecutorOf } from "../../../apps/hub-api/src/modules/packs/contracts/domain/approval-flow-notify.rules";
import {
  type CtxPd,
  createDef,
  defBody,
  G1,
  type Json,
  PA,
  startPd,
  startRun,
  sweepN,
  waitStageStatus,
  waitStatus,
} from "../P-d/_support/pd";
import { settled } from "../P-d/d2/_d2";

let c: CtxPd;
beforeAll(async () => {
  c = await startPd();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const stage = (key: string, step: number, executor: Json, extra: Json = {}): Json => ({
  key,
  name: `Bước ${key}`,
  step,
  executor,
  instruction: "",
  output: {
    filename: `${key}.md`,
    template: `# ${key}\n\n## Kết quả\n`,
    required_sections: ["Kết quả"],
    fields: [],
  },
  after: { kind: "auto" },
  real_action: false,
  answerer: { kind: "starter" },
  timeout_s: 60,
  token_budget: null,
  sources: [],
  must_know: [],
  autofix: null,
  ...extra,
});
const setStage = (key: string, step: number, extra: Json = {}): Json => ({
  ...stage(key, step, { kind: "set", values: [{ key: "v", from: { const: "x" } }] }, extra),
  output: {
    filename: `${key}.md`,
    template: `# ${key}\n\n## Kết quả\n`,
    required_sections: ["Kết quả"],
    fields: [{ key: "v", type: "string", required: true }],
  },
});
const notify = (to: Json[], channels: string[] = ["bell", "email"]): Json => ({
  kind: "notify",
  to,
  channels,
  title: "HĐ {contract-number} đã duyệt",
  body: "{contract-title} — giá trị {contract-value}",
});
const INPUTS = [
  { key: "contract-number", label: "Số HĐ", type: "text", required: false },
  { key: "contract-title", label: "Tên HĐ", type: "text", required: false },
  { key: "contract-value", label: "Giá trị", type: "number", required: false },
  { key: "contract-owner", label: "Phụ trách", type: "text", required: false },
  { key: "contract-end-date", label: "Hết hạn", type: "date", required: false },
];
const RUN_INPUTS = (owner = ""): Json[] => [
  { type: "text", key: "contract-number", text: "HD-77" },
  { type: "text", key: "contract-title", text: "Mua máy chủ" },
  { type: "number", key: "contract-value", value: "600000000" },
  ...(owner ? [{ type: "text", key: "contract-owner", text: owner }] : []),
];
const notesOf = (runId: string) =>
  c.sql<
    Json[]
  >`select user_id::text as user_id, tenant_id::text as tenant_id, kind, title, body, dedup_key
    from hub.notifications where dedup_key like ${`pn:${runId}:%`} order by user_id`;
const outputMd = async (runId: string, idx: number): Promise<string> =>
  String(
    (
      await c.sql<Json[]>`select content from hub.process_outputs where process_run_id = ${runId}
        and stage_idx = ${idx} order by version desc limit 1`
    )[0]?.content ?? "",
  );

describe("CR-121 D-6 · node notify [R1]", () => {
  it("notify sau bước duyệt: Đạt ⇒ người bắt đầu + Group 'giam-doc' nhận đúng 1 lần, mẫu đã thay biến, run done", async () => {
    await createDef(
      c,
      defBody(
        "cr121-notify-rv",
        [
          setStage("duyet", 0, { after: { kind: "review", group_id: G1, back_to_steps: [] } }),
          stage("bao", 1, notify([{ who: "starter" }, { who: "group", group_key: "giam-doc" }])),
          setStage("ket", 2),
        ],
        { inputs: INPUTS },
      ),
    );
    const runId = await startRun(c, "cr121-notify-rv", { inputs: RUN_INPUTS() });
    await waitStageStatus(c, runId, 0, "waiting_review");
    expect((await notesOf(runId)).length).toBe(0);
    const [t] = await c.sql<Json[]>`select id from hub.review_tasks where process_run_id = ${runId}
      and kind = 'review' and status = 'open' limit 1`;
    const res = await c.call("B", "POST", `/review-tasks/${t?.id}/decision`, { result: "pass" });
    expect(res.status).toBe(200);
    await settled(c);
    await waitStageStatus(c, runId, 1, "done");
    await waitStatus(c.sql, runId, "done");
    const notes = await notesOf(runId);
    expect(notes.map((n) => n.user_id).sort()).toEqual([PA.A.id, PA.H.id, PA.H2.id].sort());
    expect(new Set(notes.map((n) => n.dedup_key)).size).toBe(1);
    expect(notes[0]).toMatchObject({
      kind: "process.notify_mail",
      title: "HĐ HD-77 đã duyệt",
      body: "Mua máy chủ — giá trị 600000000",
    });
    expect(await outputMd(runId, 1)).toContain("tới 3 người");
    // Đua: ghi lại 2 lần song song cùng khoá ⇒ không thêm thông báo nào.
    const batch = JSON.stringify(
      notes.map((n) => ({
        run_id: runId,
        user_id: n.user_id,
        kind: n.kind,
        title: "lần 2",
        body: "",
        dedup_key: n.dedup_key,
      })),
    );
    const again = () =>
      c.sql.begin(async (tx) => {
        await tx`select set_config('app.scope', 'system', true)`;
        const [r] = await tx<
          { n: number }[]
        >`select notify.enqueue_run_notices(${batch}::jsonb) as n`;
        return Number(r?.n ?? -1);
      });
    expect(await Promise.all([again(), again()])).toEqual([0, 0]);
    expect((await notesOf(runId)).length).toBe(3);
  }, 60_000);

  it("người nhận rỗng ⇒ bước vẫn xong, .md ghi cảnh báo, 0 thông báo, kênh chỉ chuông", async () => {
    await createDef(
      c,
      defBody(
        "cr121-notify-empty",
        [
          stage("bao", 0, notify([{ who: "group", group_key: "khong-co-nhom" }], ["bell"])),
          setStage("ket", 1),
        ],
        { inputs: INPUTS },
      ),
    );
    const runId = await startRun(c, "cr121-notify-empty", { inputs: RUN_INPUTS() });
    await waitStatus(c.sql, runId, "done");
    expect(await outputMd(runId, 0)).toContain("Cảnh báo: không có người nhận");
    expect((await notesOf(runId)).length).toBe(0);
  }, 60_000);

  it("chặn chéo công ty: người phụ trách là user công ty khác ⇒ không nhận, chỉ người bắt đầu nhận", async () => {
    await createDef(
      c,
      defBody(
        "cr121-notify-x",
        [
          stage(
            "bao",
            0,
            notify([{ who: "starter" }, { who: "input_user", input: "contract-owner" }]),
          ),
        ],
        { inputs: INPUTS },
      ),
    );
    const runId = await startRun(c, "cr121-notify-x", { inputs: RUN_INPUTS(PA.D.id) });
    await waitStatus(c.sql, runId, "done");
    const notes = await notesOf(runId);
    expect(notes.map((n) => n.user_id)).toEqual([PA.A.id]);
    const [{ n } = { n: -1 }] = await c.sql<
      { n: number }[]
    >`select count(*)::int as n from hub.notifications
      where user_id = ${PA.D.id} and dedup_key like ${`pn:${runId}:%`}`;
    expect(n).toBe(0);
  }, 60_000);

  it("bước Chờ tới của khe duyệt HĐ: hẹn theo ngày hết hạn HĐ, tới hạn (sweep) ⇒ Thông báo chạy, run done", async () => {
    const ex = waitExecutorOf({
      kind: "wait_until",
      key: "cho",
      name: "Chờ tới",
      from: "end_date",
      offset_days: -1,
      time: "09:00",
    });
    await createDef(
      c,
      defBody(
        "cr121-wait-slot",
        [stage("cho", 0, ex), stage("bao", 1, notify([{ who: "starter" }], ["bell"]))],
        { inputs: INPUTS },
      ),
    );
    const day = new Date(c.clk.now().getTime() + 5 * 86_400_000).toISOString().slice(0, 10);
    const runId = await startRun(c, "cr121-wait-slot", {
      inputs: [...RUN_INPUTS(), { type: "date", key: "contract-end-date", value: day }],
    });
    await waitStageStatus(c, runId, 0, "waiting_timer");
    await sweepN(c);
    await waitStageStatus(c, runId, 0, "waiting_timer");
    expect((await notesOf(runId)).length).toBe(0);
    c.clk.advance(5 * 86_400_000);
    await sweepN(c);
    await waitStageStatus(c, runId, 1, "done");
    await waitStatus(c.sql, runId, "done");
    expect((await notesOf(runId)).map((x) => x.user_id)).toEqual([PA.A.id]);
  }, 60_000);
});
