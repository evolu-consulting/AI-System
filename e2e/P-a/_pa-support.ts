/// <reference lib="dom" />
// HUB-FR-104…117 · e2e P-a · helper Playwright (test-plan-e2e §1; nhãn nguyên văn plan-frontend-e2e §1–§2 + plan-frontend-thread
// §4–§5): context theo persona (`_pa-data.ts`), Runtime giả qua HTTP (`/rt/*` của stack), SQL owner dựng trạng thái run
// (`seedRun` — PF2–PF4 không phụ thuộc UI PF1). Bảng 0019 vắng (trước B1) ⇒ `seedRun` KHÔNG chèn, trả id giả `ready:false`
// ⇒ ca đỏ ở locator/expect UI (test-plan §5 e2e), không đỏ ở dựng dữ liệu.
import { randomUUID } from "node:crypto";
import { type Browser, expect, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { PW } from "../../tests/acceptance/M1/_data";
import { apiGroup, chatLogin, hub, roomComposer, roomLog, token } from "../chat/_x2a-support";
import { ACME, DEF_HD_T, fullMd, PA_E2E, PERSONA, type Who } from "./_pa-data";
import type { Step } from "./_pa-runtime";

export { badgeOf, hub, roomLink, roomLog, token } from "../chat/_x2a-support";
export { ACME, DEF_AUTO, DEF_HD_T, PA_E2E, PERSONA, SECRET_ROOM, type Who } from "./_pa-data";

// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e (playwright.pa.config đặt)
const RT = process.env.PA_RT_URL ?? "http://localhost:4503";
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e (playwright.pa.config đặt)
export const ADMIN_URL = process.env.PA_ADMIN_URL ?? "http://localhost:4505";
// biome-ignore lint/suspicious/noExplicitAny: body JSON theo contract chưa có
type Json = any;

// ---------- persona / context ----------
/** Mỗi persona một context đăng nhập chat-web riêng. */
export async function users<K extends Who>(browser: Browser, ...who: K[]) {
  const ctxs = await Promise.all(who.map(() => browser.newContext()));
  const pages = await Promise.all(ctxs.map((c) => c.newPage()));
  const out = {} as Record<K, Page>;
  for (let i = 0; i < who.length; i++) {
    const k = who[i] as K;
    const p = pages[i] as Page;
    await chatLogin(p, PERSONA[k].username);
    out[k] = p;
  }
  return { ...out, close: async () => void (await Promise.all(ctxs.map((c) => c.close()))) };
}
export const tok = (w: Who) => token(PERSONA[w].username);

/** Đăng nhập admin-web (Adm = `binh`). */
export async function adminLogin(p: Page, who: Who = "Adm"): Promise<void> {
  await p.goto(`${ADMIN_URL}/login`);
  await p.getByRole("textbox", { name: "Mã công ty" }).fill("acme");
  await p.getByRole("textbox", { name: "Tên đăng nhập" }).fill(PERSONA[who].username);
  await p.getByLabel("Mật khẩu", { exact: true }).fill(PW);
  await p.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await p.waitForURL((u) => !u.pathname.startsWith("/login"));
}

/** Phòng nhóm R mới cho ca (A chủ; mặc định thành viên B, X — T, H không ở R). */
export async function mkRoom(
  name: string,
  members: Who[] = ["B", "X"],
): Promise<{ id: string; name: string }> {
  const n = `${name} ${Date.now() % 100000}`;
  return {
    id: await apiGroup(
      await tok("A"),
      n,
      members.map((w) => PERSONA[w].id),
    ),
    name: n,
  };
}

// ---------- SQL owner ----------
export function owner() {
  return postgres(process.env.TEST_DATABASE_URL ?? "", { max: 1, onnotice: () => {} });
}
export async function withSql<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = owner();
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}
export const schemaReady = () =>
  withSql(async (sql) => {
    const [r] = await sql<
      { t: string | null }[]
    >`select to_regclass('hub.process_runs')::text as t`;
    return !!r?.t;
  });

/** Huỷ mọi run quy trình + job còn sống (giữa các ca; giới hạn 5 run/tenant). */
export async function settle(): Promise<void> {
  await rtReset();
  await withSql(async (sql) => {
    await sql`update hub.jobs set status = 'succeeded', finished_at = now() where status in ('queued', 'running')`;
    await sql`update hub.runs set status = 'cancelled', error_code = 'CANCELLED', error_message = 'e2e settle',
        error_hint = 'e2e settle', finished_at = now(), owner = null, lease_until = null
      where status in ('running', 'waiting')`;
    const [r] = await sql<
      { t: string | null }[]
    >`select to_regclass('hub.process_runs')::text as t`;
    if (r?.t)
      await sql`update hub.process_runs set status = 'cancelled', finished_at = now()
        where status not in ('done', 'cancelled', 'failed', 'expired')`;
    // Việc kiểm mở của case trước không được dồn sang case sau (huy hiệu "Chờ tôi kiểm" E-P11 = 1).
    const [t] = await sql<
      { t: string | null }[]
    >`select to_regclass('hub.review_tasks')::text as t`;
    if (t?.t)
      await sql`update hub.review_tasks set status = 'closed', result = 'cancelled', decided_at = now()
        where status = 'open'`;
  });
}

/** Σ token (vào + ra) của run = nguồn thật `usage_logs` (AC-H34). */
export const usageSum = (runId: string) =>
  withSql(async (sql) => {
    const [r] = await sql<
      { s: string | null }[]
    >`select coalesce(sum(ul.input_tokens + ul.output_tokens), 0)::text as s
      from hub.usage_logs ul join hub.runs r on r.id = ul.run_id where r.process_run_id = ${runId}`;
    return Number(r?.s ?? 0);
  });

// ---------- Runtime giả ----------
async function rtPost(op: string, body: unknown): Promise<void> {
  const r = await fetch(`${RT}/rt/${op}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(r.status, await r.clone().text()).toBe(200);
}
/** Kịch bản stage: `target` = `process_key` hoặc id run. */
export const rtScript = (target: string, stageIdx: number, steps: Step[]) =>
  rtPost("script", {
    ...(/^[0-9a-f-]{36}$/.test(target) ? { process_run_id: target } : { process_key: target }),
    stage_idx: stageIdx,
    steps,
  });
export const rtReset = () => rtPost("reset", {});
export async function rtLog(): Promise<
  { process_run_id: string; stage_idx: number; step: string; user_id: string }[]
> {
  return (await fetch(`${RT}/rt/log`)).json();
}

// ---------- dựng trạng thái run bằng SQL (plan §2.1, plan-thread §3) ----------
export type RunState = "running" | "waiting_review" | "waiting_answer" | "needs_decision" | "done";
export type SeededRun = {
  ready: boolean;
  runId: string;
  flowId: string;
  stageRunIds: string[];
  outputId: string | null;
  taskId: string | null;
};
const EXEC = { kind: "agent", key: "hd-read", name: { vi: "Đọc HĐ", en: "Đọc HĐ" } };

/**
 * Run `hoa-don-t` của A ở phòng `roomId`, đứng ở stage 0 với trạng thái `state` + tin thread tương ứng (block, output, ask,
 * decision) chèn vào `process_thread_events` (poster của hub-api đăng thành tin `process`). `opts.forwards` = số lần đã
 * chuyển (E-P10); `opts.reviewers` = user assignee thay cho Group Kế toán; `opts.usage` = ghi 1 lượt gọi/stage done.
 */
export async function seedRun(
  roomId: string | null,
  state: RunState,
  opts: { forwards?: number; reviewers?: Who[]; secret?: string; usage?: boolean } = {},
): Promise<SeededRun> {
  const runId = randomUUID();
  const flowId = randomUUID();
  if (!(await schemaReady()))
    return { ready: false, runId, flowId, stageRunIds: [], outputId: null, taskId: null };
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: fixture dựng mọi trạng thái run ở một chỗ (đọc tuần tự)
  return withSql(async (sql) => {
    const A = PERSONA.A;
    const convId = randomUUID();
    const now = new Date();
    await sql`insert into hub.conversations (id, tenant_id, user_id, title, title_norm, process_run_id)
      values (${convId}, ${ACME}, ${A.id}, ${DEF_HD_T.name}, ${DEF_HD_T.name.toLowerCase()}, ${runId})`;
    await sql`insert into hub.flows (id, tenant_id, user_id, conversation_id, title, message_count)
      values (${flowId}, ${ACME}, ${A.id}, ${convId}, ${DEF_HD_T.name}, 0)`;
    await sql`insert into hub.process_runs ${sql({
      id: runId,
      tenant_id: ACME,
      process_def_id: DEF_HD_T.id,
      def_version: 1,
      snapshot: sql.json({
        key: DEF_HD_T.key,
        name: DEF_HD_T.name,
        stages: DEF_HD_T.stages,
        token_budget: null,
        run_group_ids: DEF_HD_T.run_group_ids,
      }),
      started_by: A.id,
      origin_kind: roomId ? "room" : "admin",
      origin_room_id: roomId,
      input: `HD-12 ${opts.secret ?? ""}`.trim(),
      conversation_id: convId,
      flow_id: flowId,
      status: state,
      current_stage_idx: 0,
      decision:
        state === "needs_decision"
          ? sql.json({
              reason: "team_calls",
              stage_idx: 0,
              options: ["add_attempt", "use_current", "cancel"],
              at: now,
            })
          : null,
      expires_at: new Date(now.getTime() + 7 * 86_400_000),
      started_at: now,
      updated_at: now,
      finished_at: state === "done" ? now : null,
    })}`;
    const stageRunIds: string[] = [];
    for (let i = 0; i < DEF_HD_T.stages.length; i++) {
      const id = randomUUID();
      stageRunIds.push(id);
      const st = state === "done" ? "done" : i === 0 ? state : "pending";
      await sql`insert into hub.stage_runs (id, tenant_id, process_run_id, stage_idx, status)
        values (${id}, ${ACME}, ${runId}, ${i}, ${st})`;
    }
    const s0 = stageRunIds[0] as string;
    let outputId: string | null = null;
    if (state !== "running" && state !== "waiting_answer") {
      outputId = randomUUID();
      await sql`insert into hub.process_outputs (id, tenant_id, process_run_id, stage_run_id, stage_idx, version, attempt,
          content, template_ok)
        values (${outputId}, ${ACME}, ${runId}, ${s0}, 0, 1, 1, ${fullMd(["Bảng ý", "Số tiền"], opts.secret ?? "HD-12")},
          true)`;
      // Bất biến plan §3: có output ⇒ current_output_id trỏ bản mới nhất (use_current chỉ hiện khi has_output).
      await sql`update hub.stage_runs set current_output_id = ${outputId} where id = ${s0}`;
    }
    if (opts.usage)
      for (let i = 0; i < 2; i++) {
        const r = randomUUID();
        const mu = randomUUID();
        const ma = randomUUID();
        // hub.runs.user_message_id / answer_message_id NOT NULL → dựng cặp tin user/assistant cho lượt gọi giả lập
        await sql`insert into hub.messages (id, tenant_id, user_id, conversation_id, flow_id, role, content) values
          (${mu}, ${ACME}, ${A.id}, ${convId}, ${flowId}, 'user', 'Giai đoạn'),
          (${ma}, ${ACME}, ${A.id}, ${convId}, ${flowId}, 'assistant', 'Kết quả')`;
        await sql`insert into hub.runs (id, tenant_id, user_id, conversation_id, flow_id, status, config_version,
            user_message_id, answer_message_id, process_run_id, stage_run_id, finished_at)
          values (${r}, ${ACME}, ${A.id}, ${convId}, ${flowId}, 'finished', 1, ${mu}, ${ma}, ${runId},
            ${stageRunIds[i] as string}, now())`;
        await sql`insert into hub.usage_logs (tenant_id, run_id, user_id, agent_id, provider_key, model, billing,
            input_tokens, output_tokens, cost_usd, overage, latency_ms)
          values (${ACME}, ${r}, ${A.id}, ${i ? PA_E2E.agentPost : PA_E2E.agentRead}, 'fake-cli', 'fake-1',
            'subscription', ${1000 * (i + 1)}, ${200 * (i + 1)}, 0, false, 10)`;
      }
    const kind =
      state === "waiting_review"
        ? "review"
        : state === "waiting_answer"
          ? "ask"
          : state === "needs_decision"
            ? "decision"
            : null;
    let taskId: string | null = null;
    if (kind) {
      taskId = randomUUID();
      await sql`insert into hub.review_tasks ${sql({
        id: taskId,
        tenant_id: ACME,
        process_run_id: runId,
        stage_run_id: s0,
        kind,
        status: "open",
        output_id: kind === "review" ? outputId : null,
        question: kind === "ask" ? "Kỳ kế toán nào?" : null,
        choices: kind === "ask" ? sql.json(["09/2026", "10/2026"]) : null,
        reason: kind === "decision" ? "team_calls" : null,
        assignee_group_id: kind === "review" && !opts.reviewers ? PA_E2E.gKeToan : null,
        remind_at: new Date(now.getTime() + 86_400_000),
      })}`;
      const assignees: Who[] = kind === "review" ? (opts.reviewers ?? []) : ["A"];
      const rows: Json[] = assignees.map((w) => ({
        tenant_id: ACME,
        task_id: taskId,
        user_id: PERSONA[w].id,
        via: "initial",
        depth: 0,
      }));
      if (kind === "review" && !opts.reviewers)
        rows.push({
          tenant_id: ACME,
          task_id: taskId,
          group_id: PA_E2E.gKeToan,
          via: "initial",
          depth: 0,
        });
      // chuỗi chuyển giả lập: H, S, T (mỗi lần một người, `depth` tăng); A vẫn giữ việc để thấy nút khoá
      const chain: Who[] = ["H", "S", "T"];
      for (let d = 1; d <= (opts.forwards ?? 0); d++)
        rows.push({
          tenant_id: ACME,
          task_id: taskId,
          user_id: PERSONA[chain[d - 1] as Who].id,
          via: "forward",
          depth: d,
        });
      for (const r of rows) await sql`insert into hub.review_task_assignees ${sql(r)}`;
    }
    if (roomId) {
      const meta: Json[] = [
        {
          kind: "block",
          process_run_id: runId,
          process: { key: DEF_HD_T.key, name: DEF_HD_T.name },
          stage_count: 2,
        },
      ];
      if (outputId)
        meta.push({
          kind: "output",
          process_run_id: runId,
          stage_idx: 0,
          stage_name: "Đọc hoá đơn",
          executor: EXEC,
          output: {
            id: outputId,
            version: 1,
            attempt: 1,
            template_ok: true,
            template_missing: [],
            created_at: now,
          },
          after: "review",
          review_task_id: kind === "review" ? taskId : null,
          steps: [],
        });
      if (kind === "ask")
        meta.push({
          kind: "ask",
          process_run_id: runId,
          stage_idx: 0,
          stage_name: "Đọc hoá đơn",
          executor: EXEC,
          task_id: taskId,
          question: "Kỳ kế toán nào?",
          choices: ["09/2026", "10/2026"],
          asks_count: 1,
          ask_limit: 3,
        });
      if (kind === "decision")
        meta.push({
          kind: "decision",
          process_run_id: runId,
          stage_idx: 0,
          task_id: taskId,
          reason: "team_calls",
          options: ["add_attempt", "use_current", "cancel"],
        });
      if (state === "done")
        meta.push({ kind: "run_end", process_run_id: runId, status: "done", actor: null });
      let t = now.getTime();
      for (const m of meta)
        await sql`insert into hub.process_thread_events (id, tenant_id, process_run_id, room_id, kind, placement, meta,
            content, created_at)
          values (${randomUUID()}, ${ACME}, ${runId}, ${roomId}, ${m.kind}, ${m.kind === "block" ? "main" : "flow"},
            ${sql.json(m)}, ${`${DEF_HD_T.name} · ${m.kind}`}, ${new Date(t++)})`;
    }
    return { ready: true, runId, flowId, stageRunIds, outputId, taskId };
  });
}

// ---------- locator (plan-frontend-e2e §1, plan-frontend-thread §4–§5) ----------
export const roomBox = (p: Page) => roomComposer(p, "nhóm");
export const processMenu = (p: Page) => p.getByRole("listbox", { name: "Quy trình" });
export const processBtn = (p: Page) => p.getByRole("button", { name: "Quy trình", exact: true });
export const block = (p: Page, name: string = DEF_HD_T.name) =>
  roomLog(p).getByRole("article", { name: `Quy trình ${name}` });
export const flowPane = (p: Page) => p.getByRole("complementary", { name: "Flow đang mở" });
export const flowLog = (p: Page) => p.getByRole("log", { name: "Tin nhắn trong flow" });
export const flowBox = (p: Page) => p.getByRole("textbox", { name: "Tin nhắn trong flow" });
export const outputMsg = (scope: Page | Locator, stage = "Đọc hoá đơn", v = 1) =>
  scope.getByRole("article", { name: `Kết quả ${stage} v${v}` });
/** Tin kết quả task "<người> · <Đạt|Chưa đạt|Đã trả lời> · <giờ>" (không exact, R2-8). */
export const taskResult = (scope: Page | Locator, who: string, result: string) =>
  scope.getByRole("article", { name: new RegExp(`${who} · ${result} · `, "i") });
export const passBtn = (scope: Page | Locator) =>
  scope.getByRole("button", { name: "Đạt", exact: true });
export const failBtn = (scope: Page | Locator) =>
  scope.getByRole("button", { name: "Chưa đạt", exact: true });
export const waitingNote = (scope: Page | Locator, text: RegExp | string) =>
  scope.getByRole("status").filter({ hasText: text });

/** Gõ + Gửi ở composer phòng; trả header `X-Process-Run-Id`/`X-Flow-Id` (null nếu Hub chưa tạo run). */
export async function sendRoom(
  p: Page,
  text: string,
): Promise<{ processRunId: string | null; flowId: string | null; status: number }> {
  await roomBox(p).fill(text);
  const resp = p.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      /\/rooms\/[^/]+\/messages$/.test(new URL(r.url()).pathname),
  );
  await p.getByRole("button", { name: "Gửi", exact: true }).click();
  const r = await resp;
  const h = r.headers();
  return {
    processRunId: h["x-process-run-id"] ?? null,
    flowId: h["x-flow-id"] ?? null,
    status: r.status(),
  };
}
/** Như `sendRoom` nhưng đòi có run (chưa có ⇒ đỏ ở expect này). */
export async function startUi(p: Page, text: string): Promise<{ runId: string; flowId: string }> {
  const s = await sendRoom(p, text);
  expect(s.processRunId, "POST `!key` phải trả X-Process-Run-Id").toBeTruthy();
  return { runId: s.processRunId as string, flowId: s.flowId as string };
}
/** Bắt đầu run qua API (A, origin phòng) — dùng ở ca không kiểm composer. */
export async function startApi(who: Who, key: string, input: string, roomId: string | null) {
  const r = await hub(await tok(who), "POST", "/process-runs", {
    process_key: key,
    input,
    origin: roomId ? { kind: "room", room_id: roomId } : { kind: "none" },
  });
  expect(r.status, "POST /process-runs").toBe(201);
  return r.json as Json;
}
/** Mở thread `?flow=` từ khối quy trình ("Trả lời tiếp"). */
export async function openThread(
  p: Page,
  roomId: string,
  name: string = DEF_HD_T.name,
): Promise<void> {
  await p.goto(`/rooms/${roomId}`);
  await block(p, name).getByRole("button", { name: "Trả lời tiếp" }).click();
  await expect(flowPane(p)).toBeVisible();
}
/** Số tin `sender_type=user` trong thread (Hub, người xem `who`). */
export async function userMsgsInFlow(who: Who, roomId: string, flowId: string): Promise<number> {
  const r = await hub(
    await tok(who),
    "GET",
    `/rooms/${roomId}/messages?flow_id=${flowId}&limit=100`,
  );
  return ((r.json?.items ?? []) as Json[]).filter((m) => m.sender_type === "user").length;
}

/**
 * Kịch bản: chép mẫu seed (`sdlc` / `hoa-don`, `tenant_id` null — B3) sang acme bằng SQL, gán Group kiểm theo thứ tự các
 * stage `after.kind="review"` (`groups[i]`), bật. Mẫu/bảng chưa có ⇒ trả false (ca đỏ ở UI).
 */
export async function copyTemplate(key: string, groups: string[]): Promise<boolean> {
  if (!(await schemaReady())) return false;
  return withSql(async (sql) => {
    const [t] = await sql<
      { id: string; name: string; description: string; input_hint: string; stages: Json[] }[]
    >`
      select id, name, description, input_hint, stages from hub.process_defs
      where tenant_id is null and key = ${key} and deleted_at is null`;
    if (!t) return false;
    let i = 0;
    const stages = t.stages.map((s: Json) =>
      s.after?.kind === "review"
        ? { ...s, after: { ...s.after, group_id: groups[i++] ?? null } }
        : s,
    );
    // Cập nhật tại chỗ nếu acme đã có bản (seed production chép sẵn `hoa-don`) — không xoá mềm + chèn lại (khoá key trùng).
    const upd =
      await sql`update hub.process_defs set stages = ${sql.json(stages)}, run_group_ids = '{}'::uuid[],
        enabled = true, source_template_id = ${t.id}, updated_at = now()
      where tenant_id = ${ACME} and key = ${key} and deleted_at is null returning id`;
    if (upd.length === 0)
      await sql`insert into hub.process_defs (id, tenant_id, key, name, description, input_hint, run_group_ids, stages,
          token_budget, enabled, source_template_id, version)
        values (${randomUUID()}, ${ACME}, ${key}, ${t.name}, ${t.description}, ${t.input_hint}, '{}'::uuid[],
          ${sql.json(stages)}, null, true, ${t.id}, 1)`;
    await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
    return true;
  });
}
