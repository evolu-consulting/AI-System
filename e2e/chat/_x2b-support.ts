/// <reference lib="dom" />
// HUB-FR-101 · HUB-FR-103 · e2e X2b · helper (test-plan-e2e.md; nhãn nguyên văn `plan-frontend-e2e.md` §1): 3 context A/B/C,
// Runtime giả qua HTTP (`_x2b-runtime.ts` trong stack), SQL owner cho dữ liệu "ngoài API" (thu hồi quyền, `tool_confirmations`).
// A = `lan` "Lan Tran" (hoadon, trello) · B = `thu` "Thu Ha" (chỉ trello) · C = `an` "An Nguyen" (chỉ hoadon). Agent hiển thị
// bằng tên = key ("hoadon") và "Trello".
import { type Browser, expect, type Page } from "@playwright/test";
import postgres from "postgres";
import {
  ACME,
  apiGroup,
  chatLogin,
  HUB,
  NAMES,
  roomComposer,
  roomLog,
  token,
  USER_ID,
  uniq,
} from "./_x2a-support";

export {
  apiGroup,
  badgeOf,
  hub,
  NAMES,
  roomLink,
  roomLog,
  token,
  USER_ID,
  uniq,
} from "./_x2a-support";

// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e (playwright.x2b.config đặt)
const RT = process.env.X2B_RT_URL ?? "http://localhost:4058";
export const SECRET = "PARAM-SECRET-77";

/** Hai/ba context đăng nhập sẵn: A, B, C. */
export async function threeUsers(browser: Browser) {
  const ctxs = await Promise.all([
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
  ]);
  const [pa, pb, pc] = (await Promise.all(ctxs.map((c) => c.newPage()))) as [Page, Page, Page];
  await chatLogin(pa, "lan");
  await chatLogin(pb, "thu");
  await chatLogin(pc, "an");
  return { pa, pb, pc, close: async () => Promise.all(ctxs.map((c) => c.close())) };
}

/** Nhóm A + B + C (A là chủ). */
export const mkRoom = async (name: string): Promise<{ id: string; name: string }> => {
  const n = uniq(name);
  return { id: await apiGroup(await token("lan"), n, [USER_ID.thu, USER_ID.an]), name: n };
};

// ---------- Runtime giả (stack) ----------
type AgentResult =
  | { status: "done"; text: string }
  | { status: "need_input"; question: string; choices: string[] };
export async function rt(op: "claim" | "answer", runId: string, result?: AgentResult) {
  const r = await fetch(`${RT}/rt/${op}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ run_id: runId, result }),
  });
  expect(r.status, await r.clone().text()).toBe(200);
}
export const answer = (runId: string, text: string) =>
  rt("answer", runId, { status: "done", text });

// ---------- SQL owner ----------
export function owner() {
  return postgres(process.env.TEST_DATABASE_URL ?? "", { max: 1, onnotice: () => {} });
}
/** Kết thúc mọi run còn chạy/chờ (giữa các ca, giới hạn 2 run). */
export async function settleRuns(): Promise<void> {
  const sql = owner();
  try {
    await sql`update hub.jobs set status = 'succeeded', finished_at = now() where status in ('queued', 'running')`;
    await sql`update hub.runs set status = 'cancelled', finished_at = now(), owner = null, lease_until = null
      where status in ('running', 'waiting')`;
  } finally {
    await sql.end();
  }
}
/** `tool_confirmations` pending cho run (side_effect, như C1/H2a). */
export async function pendConfirm(
  runId: string,
  userId: string,
  tenantId: string = ACME,
): Promise<void> {
  const sql = owner();
  try {
    const [run] = await sql<{ flow_id: string; agent_id: string }[]>`
      select flow_id, agent_id from hub.runs where id = ${runId}`;
    await sql`insert into hub.tool_confirmations (tenant_id, user_id, flow_id, run_id, agent_id, workflow_id, status)
      values (${tenantId}, ${userId}, ${run?.flow_id ?? runId}, ${runId}, ${run?.agent_id ?? null},
        'a2bb0000-0000-4000-8000-000000008001', 'pending')`;
  } finally {
    await sql.end();
  }
}
/** Thu hồi / cấp lại grant agent của user (trực tiếp SQL) + tăng `hub_config_version`; Hub poll 2s. */
export async function setGrant(agentKey: string, userId: string, on: boolean): Promise<void> {
  const sql = owner();
  try {
    const [a] = await sql<{ id: string }[]>`select id from hub.agents where key = ${agentKey}`;
    if (on)
      await sql`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
        values (${a?.id ?? ""}, ${ACME}, 'user', ${userId}) on conflict do nothing`;
    else
      await sql`delete from hub.agent_grants where agent_id = ${a?.id ?? ""} and subject_type = 'user'
        and subject_id = ${userId}`;
    await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
  } finally {
    await sql.end();
  }
}

// ---------- UI ----------
export const agentMenu = (p: Page) => p.getByRole("listbox", { name: "Agent" });
export const roomBox = (p: Page) => roomComposer(p, "nhóm");
export const agentBlock = (p: Page, agent = "hoadon") =>
  roomLog(p).getByRole("article", { name: `Trả lời của agent ${agent}` });
export const working = (p: Page, agent = "hoadon") =>
  p.getByRole("status").filter({ hasText: `${agent} đang xử lý…` });
export const flowPane = (p: Page) => p.getByRole("complementary", { name: "Flow đang mở" });
export const flowBox = (p: Page) => p.getByRole("textbox", { name: "Tin nhắn trong flow" });

/** Gõ + bấm "Gửi" ở composer phòng; trả header run nếu có (chờ POST tin phòng). */
export async function sendRoom(
  p: Page,
  text: string,
): Promise<{ runId: string | null; flowId: string | null }> {
  await roomBox(p).fill(text);
  const resp = p.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      /\/rooms\/[^/]+\/messages$/.test(new URL(r.url()).pathname),
  );
  await p.getByRole("button", { name: "Gửi", exact: true }).click();
  const h = (await resp).headers();
  return { runId: h["x-run-id"] ?? null, flowId: h["x-flow-id"] ?? null };
}
/** Như `sendRoom` nhưng đòi có run (UI chưa có ⇒ đỏ ở expect này, không ở dựng stack). */
export async function invokeUi(p: Page, text: string): Promise<{ runId: string; flowId: string }> {
  const s = await sendRoom(p, text);
  expect(s.runId, "POST tin có tag phải trả X-Run-Id").toBeTruthy();
  return { runId: s.runId as string, flowId: s.flowId as string };
}
/** Gửi trong khung flow (mọi thành viên). */
export async function sendFlow(p: Page, text: string): Promise<void> {
  await flowBox(p).fill(text);
  await p.getByRole("button", { name: "Gửi trong flow" }).click();
}

/** POST tin phòng thô qua Hub (đòi `flow_id`/`answer_run_id` giả mạo). */
export async function postRaw(tok: string, roomId: string, body: Record<string, unknown>) {
  const r = await fetch(`${HUB}/rooms/${roomId}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
    body: JSON.stringify({ client_msg_id: crypto.randomUUID(), ...body }),
  });
  const t = await r.text();
  return { status: r.status, headers: r.headers, json: t ? JSON.parse(t) : undefined };
}
export { NAMES as N };
