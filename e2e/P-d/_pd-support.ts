/// <reference lib="dom" />
// HUB-FR-143 · HUB-FR-144 · HUB-FR-145 · ADM-FR-71 · ADM-FR-72 · P-d1 · e2e helper (test-plan-e2e §1; nhãn NGUYÊN VĂN plan-frontend §7
// + i18n). Stack = stack P-b2 (Hub THẬT + Runtime giả P-a + admin-web + chat-web). Trạng thái chờ hẹn/thử lại/chuyển cấp dựng bằng
// SQL (stage `waiting_timer` + hàng `process_timers`; ĐỒNG HỒ KHÔNG chạy — không ngủ chờ, không cần sweepOnce). Bảng 0036 vắng ⇒
// KHÔNG chèn, trả `ready:false` ⇒ ca đỏ ở locator, không đỏ ở dựng dữ liệu.
import { randomUUID } from "node:crypto";
import { PW, TENANT_ID } from "../../tests/acceptance/M1/_data";
import { PA_E2E, PERSONA } from "../P-a/_pa-data";
import { ACME, seedRun, withSql } from "../P-a/_pa-support";

export {
  adminLogin,
  hub,
  mkRoom,
  seedRun,
  settle,
  tok,
  users,
  withSql,
} from "../P-a/_pa-support";
export { defByKey, node, openDef, panel, saveDef } from "../P-b2/_pb2-support";

// biome-ignore lint/suspicious/noExplicitAny: json theo contract
type Json = any;

const x = (n: number) => `d1e20000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const PD_E2E = { gGD: x(1), defEdit: x(21), defBad: x(22), defInput: x(23) } as const;

/** Hạn chờ chuẩn (02:00Z = 09:00 giờ HCM). */
export const DUE_WAIT = "2026-11-17T02:00:00.000Z";

/** 0036 có chưa. */
export const pdReady = () =>
  withSql(async (sql) => {
    const [r] = await sql<
      { ok: boolean }[]
    >`select to_regclass('hub.process_timers') is not null as ok`;
    return r?.ok === true;
  });

const FIELD_NGAY = [{ key: "ngay_het_han", type: "date", required: false }];
const stageOf = (key: string, name: string, step: number, o: Json = {}): Json => ({
  key,
  name,
  step,
  executor: { kind: "agent", agent_id: PA_E2E.agentRead },
  instruction: `Thực hiện ${name}.`,
  output: {
    filename: `${key}.md`,
    template: "## Kết quả\n",
    required_sections: ["Kết quả"],
    fields: [],
  },
  after: { kind: "auto" },
  real_action: false,
  answerer: { kind: "starter" },
  timeout_s: 1800,
  token_budget: null,
  sources: [],
  must_know: [],
  ...o,
});
const out = (key: string, fields: Json[]): Json => ({
  filename: `${key}.md`,
  template: "## Kết quả\n",
  required_sections: ["Kết quả"],
  fields,
});
const waitEx = (from: Json): Json => ({
  kind: "wait_until",
  from,
  offset_days: -3,
  time: "09:00",
});

/**
 * Group "Giám đốc" (acme; H = q01 là thành viên) + def `pd-edit` (s0 "Đọc hồ sơ" có trường ngày + gate Kế toán P-a; s1 "Chờ hạn";
 * s2 "Hoàn tất"), `pd-bad` (stage "Chờ cùng bước" lấy ngày từ stage cùng bước ⇒ WAIT_INVALID) và `pd-wait-input` (nguồn ngày từ
 * input kiểu date). Idempotent (đặt lại stages mỗi lần). jsonb ⇒ nạp được trước code.
 */
export async function seedPd(): Promise<void> {
  await withSql(async (sql) => {
    await sql`insert into admin.groups (id, tenant_id, key, name)
      values (${PD_E2E.gGD}, ${ACME}, 'giam-doc-pd', ${sql.json({ vi: "Giám đốc", en: "Directors" })})
      on conflict do nothing`;
    await sql`insert into admin.group_members (tenant_id, group_id, user_id)
      values (${ACME}, ${PD_E2E.gGD}, ${PERSONA.H.id}) on conflict do nothing`;
    const defs = [
      {
        id: PD_E2E.defEdit,
        key: "pd-edit",
        name: "Chờ hạn E2E",
        inputs: [],
        runGroups: [] as string[],
        stages: [
          stageOf("doc", "Đọc hồ sơ", 0, {
            output: out("doc", FIELD_NGAY),
            after: { kind: "review", group_id: PA_E2E.gKeToan },
          }),
          stageOf("cho", "Chờ hạn", 1),
          stageOf("xong", "Hoàn tất", 2),
        ],
      },
      {
        id: PD_E2E.defBad,
        key: "pd-bad",
        name: "Chờ cùng bước",
        inputs: [],
        runGroups: [] as string[],
        stages: [
          stageOf("doc", "Đọc hồ sơ", 0, { output: out("doc", FIELD_NGAY) }),
          stageOf("cho", "Chờ sai nguồn", 0, {
            executor: waitEx({ kind: "field", stage_key: "doc", field: "ngay_het_han" }),
          }),
        ],
      },
      {
        id: PD_E2E.defInput,
        key: "pd-wait-input",
        name: "Chờ nhập ngày",
        inputs: [{ key: "han", type: "date", label: "Hạn", required: true }],
        runGroups: [PA_E2E.gRun],
        stages: [
          stageOf("cho", "Chờ hạn", 0, { executor: waitEx({ kind: "input", key: "han" }) }),
          stageOf("xong", "Hoàn tất", 1),
        ],
      },
    ];
    for (const d of defs)
      await sql`insert into hub.process_defs (id, tenant_id, key, name, description, input_hint, run_group_ids, stages,
          token_budget, enabled, version, sources, inputs)
        values (${d.id}, ${ACME}, ${d.key}, ${d.name}, ${`Quy trình e2e P-d ${d.name}.`}, 'Mã hồ sơ',
          ${sql.array(d.runGroups)}::uuid[], ${sql.json(d.stages)}, null, true, 1, ${sql.json([])}, ${sql.json(d.inputs)})
        on conflict (id) do update set stages = excluded.stages, inputs = excluded.inputs, ttl_days = 7,
          version = hub.process_defs.version + 1`;
    await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
  });
}

/** Run `running` (seedRun P-a) ⇒ stage 0 `waiting_timer` + hẹn mở (`wait`: wait_until HCM; `retry`: retry_count 2). Trả `ready`. */
export async function seedTimerRun(
  roomId: string,
  kind: "wait" | "retry",
): Promise<{ runId: string; ready: boolean }> {
  const r = await seedRun(roomId, "running");
  if (!(await pdReady())) return { runId: r.runId, ready: false };
  await withSql(async (sql) => {
    const s0 = r.stageRunIds[0] as string;
    const retry = kind === "retry";
    await sql`update hub.stage_runs set status = 'waiting_timer', retry_count = ${retry ? 2 : 0},
        last_error_code = ${retry ? "job_failed" : null} where id = ${s0}`;
    await sql`update hub.process_runs set status = 'waiting_timer' where id = ${r.runId}`;
    await sql`insert into hub.process_timers (tenant_id, process_run_id, stage_run_id, kind, due_at, timezone, idempotency_key)
      values (${ACME}, ${r.runId}, ${s0}, ${retry ? "retry" : "wait_until"},
        ${retry ? new Date(Date.now() + 600_000) : new Date(DUE_WAIT)},
        ${retry ? null : "Asia/Ho_Chi_Minh"}, ${`pd-e2e-${randomUUID()}`})`;
  });
  return { runId: r.runId, ready: true };
}

/** Run `needs_decision` (seedRun P-a) ⇒ lý do P-d (`retry_exhausted` | `timer_invalid`). Trả `ready`. */
export async function seedPdDecision(
  roomId: string,
  reason: "retry_exhausted" | "timer_invalid",
): Promise<{ runId: string; ready: boolean }> {
  const r = await seedRun(roomId, "needs_decision");
  if (!(await pdReady())) return { runId: r.runId, ready: false };
  await withSql(async (sql) => {
    await sql`update hub.review_tasks set reason = ${reason} where process_run_id = ${r.runId} and kind = 'decision'`;
    await sql`update hub.process_runs set decision = decision || ${sql.json({ reason, options: ["add_attempt", "use_current", "cancel"] })}
      where id = ${r.runId}`;
  });
  return { runId: r.runId, ready: true };
}

/** Run `waiting_review` đã chuyển cấp tới Group "Giám đốc" (H thuộc nhóm) + thông báo `escalated` cho H. Trả `ready`. */
export async function seedEscalated(roomId: string): Promise<{ runId: string; ready: boolean }> {
  const r = await seedRun(roomId, "waiting_review");
  if (!(await pdReady())) return { runId: r.runId, ready: false };
  await withSql(async (sql) => {
    await sql`update hub.review_tasks set escalate_group_id = ${PD_E2E.gGD}, escalate_at = now() - interval '1 hour',
        escalated_at = now() where id = ${r.taskId}`;
    await sql`insert into hub.review_task_assignees (tenant_id, task_id, group_id, via, depth)
      values (${ACME}, ${r.taskId}, ${PD_E2E.gGD}, 'escalated', 0)`;
    await sql`insert into hub.process_notices (tenant_id, user_id, kind, process_run_id, task_id, payload)
      values (${ACME}, ${PERSONA.H.id}, 'escalated', ${r.runId}, ${r.taskId},
        ${sql.json({ process_name: "Hoá đơn T", stage_name: "Đọc hoá đơn" })})`;
  });
  return { runId: r.runId, ready: true };
}

// ---------- P-d2 (test-plan-d2 §5 · test-plan-e2e PD2-E01…E05; nhãn nguyên văn plan-frontend-d2 §13 + mockup 04) ----------
const w = (n: number) => `d2e20000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const PD2_E2E = {
  W: { id: w(1), key: "xuat-hoa-don", name: "Xuất HĐ" },
  WS: { id: w(2), key: "ghi-so", name: "Ghi sổ" },
  WF: { id: w(3), key: "tai-tep", name: "Tải tệp" },
  WOFF: { id: w(4), key: "het-han", name: "Hết hạn" },
  defTool: w(21),
  defBranch: w(22),
  defGlobex: w(23),
} as const;
export const GLOBEX = TENANT_ID.globex;

/** Fail NGAY, lý do rõ, khi thiếu tiền đề P-d2 (Luật 4c): 0012 công tắc tool (T18a) + 0037 `skipped` (T17). */
export async function needPd2(): Promise<void> {
  const r = await withSql(async (sql) => {
    const [x] = await sql<{ tools: boolean; skipped: boolean }[]>`select
      to_regclass('admin.tenant_workflow_tools') is not null as tools,
      exists (select 1 from pg_constraint where conrelid = 'hub.stage_runs'::regclass
              and pg_get_constraintdef(oid) like '%skipped%') as skipped`;
    return x;
  });
  if (!r?.tools)
    throw new Error("chưa có tính năng: công tắc tool admin.tenant_workflow_tools (T18a)");
  if (!r?.skipped)
    throw new Error("chưa có tính năng: stage_runs.status skipped (migration 0037, T17)");
}

const PARAMS = [
  { name: "tong_tien", type: "number", required: true, label: "Tổng tiền" },
  { name: "ma_kh", type: "text", required: false, label: "Mã KH" },
];
/** Workflow catalog (owner SQL) + công tắc: acme bật W, WS, WF; globex bật `globexOn`. Idempotent. */
export async function seedPd2Tools(globexOn: (keyof typeof PD2_E2E)[] = []): Promise<void> {
  await needPd2();
  await withSql(async (sql) => {
    const rows = [
      [PD2_E2E.W, false, true, PARAMS],
      [PD2_E2E.WS, true, true, PARAMS],
      [PD2_E2E.WF, false, true, [{ name: "tep", type: "file", required: true, label: "Tệp" }]],
      [PD2_E2E.WOFF, false, false, PARAMS],
    ] as const;
    for (const [wf, side, enabled, params] of rows)
      await sql`insert into admin.workflows (id, key, name, description, app_type, base_url, secret_id, input_schema,
          output_field, enabled, side_effect)
        values (${wf.id}, ${wf.key}, ${wf.name}, 'Workflow e2e P-d2.', 'workflow', 'http://127.0.0.1:9', null,
          ${sql.json(params as never)}, 'result', ${enabled}, ${side})
        on conflict (id) do update set enabled = excluded.enabled, side_effect = excluded.side_effect,
          input_schema = excluded.input_schema, name = excluded.name`;
    await sql`delete from admin.tenant_workflow_tools where workflow_id in ${sql([PD2_E2E.W.id, PD2_E2E.WS.id, PD2_E2E.WF.id, PD2_E2E.WOFF.id])}`;
    for (const wf of [PD2_E2E.W, PD2_E2E.WS, PD2_E2E.WF])
      await sql`insert into admin.tenant_workflow_tools (workflow_id, tenant_id, granted_at) values (${wf.id}, ${ACME}, now())`;
    for (const k of globexOn) {
      const wf = PD2_E2E[k] as { id: string };
      await sql`insert into admin.tenant_workflow_tools (workflow_id, tenant_id, granted_at) values (${wf.id}, ${GLOBEX}, now())`;
    }
    await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
  });
}

/** Tắt hẳn công tắc acme của W (cho ca padmin bật từ đầu). */
export const clearAcmeSwitch = (): Promise<void> =>
  withSql(async (sql) => {
    await sql`delete from admin.tenant_workflow_tools where workflow_id = ${PD2_E2E.W.id} and tenant_id = ${ACME}`;
  });

/** Def acme `pd2-tool` (s0 "Đọc hồ sơ" có trường tong_tien; s1 "Xuất hoá đơn"; s2) + `pd2-branch` (4 bước; s0 "Phân loại" đứng một mình)
 *  + def globex `pd2-globex`. jsonb ⇒ nạp được trước code. Idempotent (đặt lại stages mỗi lần). */
export async function seedPd2Defs(): Promise<void> {
  await withSql(async (sql) => {
    const num = [{ key: "tong_tien", type: "number", required: true }];
    const defs = [
      {
        id: PD2_E2E.defTool,
        tenant: ACME,
        key: "pd2-tool",
        name: "Gọi tool E2E",
        stages: [
          stageOf("doc", "Đọc hồ sơ", 0, { output: out("doc", num) }),
          stageOf("xhd", "Xuất hoá đơn", 1),
          stageOf("xong", "Hoàn tất", 2),
        ],
      },
      {
        id: PD2_E2E.defBranch,
        tenant: ACME,
        key: "pd2-branch",
        name: "Rẽ nhánh E2E",
        stages: [
          stageOf("pl", "Phân loại", 0, { output: out("pl", num) }),
          stageOf("b1", "Bước hai", 1),
          stageOf("b2", "Bước ba", 2),
          stageOf("b3", "Bước bốn", 3),
        ],
      },
      {
        id: PD2_E2E.defGlobex,
        tenant: GLOBEX,
        key: "pd2-globex",
        name: "Công ty khác E2E",
        stages: [stageOf("a", "Đọc hồ sơ", 0), stageOf("b", "Xuất hoá đơn", 1)],
      },
    ];
    for (const d of defs)
      await sql`insert into hub.process_defs (id, tenant_id, key, name, description, input_hint, run_group_ids, stages,
          token_budget, enabled, version, sources, inputs)
        values (${d.id}, ${d.tenant}, ${d.key}, ${d.name}, ${`Quy trình e2e P-d2 ${d.name}.`}, 'Mã hồ sơ',
          '{}'::uuid[], ${sql.json(d.stages)}, null, true, 1, ${sql.json([])}, ${sql.json([])})
        on conflict (id) do update set stages = excluded.stages, version = hub.process_defs.version + 1`;
    await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
  });
}

/** Đăng nhập admin-web bằng tenant/user bất kỳ (mật khẩu seed M1). */
export async function loginAs(
  p: import("@playwright/test").Page,
  tenant: string,
  username: string,
): Promise<void> {
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e (playwright.pd.config đặt)
  await p.goto(`${process.env.PA_ADMIN_URL ?? "http://localhost:5305"}/login`);
  await p.getByRole("textbox", { name: "Mã công ty" }).fill(tenant);
  await p.getByRole("textbox", { name: "Tên đăng nhập" }).fill(username);
  await p.getByLabel("Mật khẩu", { exact: true }).fill(PW);
  await p.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await p.waitForURL((u) => !u.pathname.startsWith("/login"));
}

/** Run `needs_decision` `tool_failed` + stage cuối `skipped` + tin thread "Rẽ nhánh: …" (placement flow). Trả runId. */
export async function seedPd2Run(roomId: string): Promise<string> {
  await needPd2();
  const r = await seedRun(roomId, "needs_decision");
  await withSql(async (sql) => {
    await sql`update hub.review_tasks set reason = 'tool_failed' where process_run_id = ${r.runId} and kind = 'decision'`;
    await sql`update hub.process_runs set decision = decision || ${sql.json({ reason: "tool_failed" })} where id = ${r.runId}`;
    await sql`update hub.stage_runs set status = 'skipped', finished_at = now() where id = ${r.stageRunIds.at(-1) as string}`;
    await sql`insert into hub.process_thread_events (id, tenant_id, process_run_id, room_id, kind, placement, meta, content, created_at)
      values (${randomUUID()}, ${ACME}, ${r.runId}, ${roomId}, 'branch', 'flow',
        ${sql.json({ kind: "branch", process_run_id: r.runId, stage_idx: 1, to_step: 3, rule: 1 })},
        'Rẽ nhánh: tới bước 4 (luật 1)', now())`;
  });
  return r.runId;
}
