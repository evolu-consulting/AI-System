// dlc-engine · bước DLC của dây chuyền build: `setup` (sinh agent domain/QC từ plan đã duyệt, lệnh test, việc vào queue),
// `build` (lấy việc kế → agent domain làm trên nhánh riêng → `integrate` = merge tuần tự + cổng test; lỗi ⇒ việc về đầu queue,
// workspace giới hạn số lần thử) và `verify` (agent nghiệm thu 100% spec; khoảng trống ⇒ việc sửa vào queue + build lại, tối đa
// `rounds` vòng). Queue nằm ở workspace ⇒ bước bị ngắt giữa chừng chạy lại thì làm tiếp việc còn lại. Lớp 2.
import {
  buildPrompt,
  domainAgentOf,
  jsonBlock,
  type QueueItem,
  tasksOf,
  teamOf,
  verifyPrompt,
} from "../domain/dlc-prompts.rules";
import { callAgent, fail, need, out, type StepCtx, type StepOut, save } from "./step-context";

const BUILD_MAX_ITEMS = 200;
const DEV_TEMPLATE = "dlc-build";
const QC_TEMPLATE = "dlc-qc";

const devDomains = (c: StepCtx): string[] =>
  teamOf(need(c.flow.state.plan, "plan (bước spec)")).dev.map((a) => a.domain);

export async function setupStep(c: StepCtx): Promise<StepOut> {
  const plan = need(c.flow.state.plan, "plan (bước spec)");
  const port = c.d.hub.port ?? fail("Agent Hub chưa nối");
  const team = teamOf(plan);
  const who = {
    tenantId: c.tenantId,
    userId: c.flow.startedBy,
    conversationId: c.flow.conversationId ?? "",
  };
  const p = c.flow.project;
  const spawned = await port.spawn(who, { project: p, template: DEV_TEMPLATE, agents: team.dev });
  if (team.qc.length) await port.spawn(who, { project: p, template: QC_TEMPLATE, agents: team.qc });
  const cmd = c.flow.state.testCommand ?? "npm test";
  await c.d.ws.settings(p, { testCommand: cmd, stack: String(plan.stack ?? "").slice(0, 200) });
  const tag = need(c.flow.state.tag, "mã lượt (bước khởi tạo)");
  const tasks = tasksOf(
    plan.tasks,
    tag,
    team.dev.map((a) => a.domain),
    "plan",
  );
  await c.d.ws.enqueue(p, tasks);
  await save(c, { spawned });
  return out(
    c,
    "done",
    `${spawned.length} agent domain, ${team.qc.length} agent QC, ${tasks.length} việc vào queue`,
  );
}

/** Một việc của queue: agent domain làm trên nhánh riêng → `integrate` (merge tuần tự + cổng test). Trả dòng log. */
async function buildItem(c: StepCtx, item: QueueItem): Promise<string> {
  const p = c.flow.project;
  const agent = domainAgentOf(p, item.domain ?? "", c.flow.state.spawned ?? []);
  const prompt = buildPrompt({
    project: p,
    item,
    testCommand: c.flow.state.testCommand ?? "npm test",
    planText: c.flow.state.planText ?? "",
  });
  const who = {
    tenantId: c.tenantId,
    userId: c.flow.startedBy,
    conversationId: c.flow.conversationId ?? "",
  };
  const res = await c.d.hub.port?.call(who, agent, prompt, c.signal);
  const r = await c.d.ws.integrate(p, item.id);
  const it = r.item ?? item;
  const tests = r.ok ? "PASS" : "FAIL";
  return `- ${item.id}: agent=${res?.status ?? "none"}, merged=${r.merged}, tests=${tests} -> ${it.status ?? "?"} (attempt ${it.attempts ?? 0})`;
}

/** Vòng build: một việc mỗi lượt, tuần tự, tới khi queue rỗng. Trả log (một dòng / việc). */
async function drainQueue(c: StepCtx): Promise<string> {
  const lines: string[] = [];
  for (let i = 0; i < BUILD_MAX_ITEMS; i++) {
    if (c.signal?.aborted) fail("hết hạn bước build");
    const item = await c.d.ws.next(c.flow.project);
    if (!item) break;
    lines.push(await buildItem(c, item));
  }
  return lines.join("\n");
}

export async function buildStep(c: StepCtx): Promise<StepOut> {
  need(c.flow.state.spawned, "đội agent (bước chuẩn bị)");
  if (c.flow.conversationId === null) fail("lượt không gắn hội thoại Chat");
  if (c.feedback?.trim()) await enqueueFeedback(c, c.feedback.trim());
  const log = await drainQueue(c);
  await save(c, { buildLog: `${c.flow.state.buildLog ?? ""}${log}\n` });
  const v = await c.d.ws.project(c.flow.project);
  const s = v.summary;
  return out(c, Number(s.failed ?? 0) > 0 ? "failed_items" : "done", summaryOf(s));
}

/** Người duyệt trả bước build về (vd ở cổng duyệt deploy) ⇒ góp ý thành MỘT việc sửa đầu queue cho dev agent. */
async function enqueueFeedback(c: StepCtx, feedback: string): Promise<void> {
  const tag = need(c.flow.state.tag, "mã lượt");
  const n = (c.flow.state.buildLog ?? "").split("\n").length;
  const [item] = tasksOf(
    [{ id: `rv${n}`, title: "Reviewer feedback", detail: feedback, acceptance: feedback }],
    tag,
    devDomains(c),
    "verify",
  );
  if (item) await c.d.ws.enqueue(c.flow.project, [item]);
}

const summaryOf = (s: Record<string, unknown>): string =>
  `${s.ready_to_deploy ?? 0} sẵn sàng deploy, ${s.failed ?? 0} lỗi, ${s.queued ?? 0} còn chờ (tổng ${s.total ?? 0})`;

/** Một lượt nghiệm thu: agent đối chiếu spec; trả báo cáo + độ phủ + việc sửa. */
async function verifyOnce(c: StepCtx, round: number, prev: string) {
  const prompt = verifyPrompt(c.a.mode, {
    project: c.flow.project,
    spec: need(c.flow.state.spec, "spec đầu vào"),
    testCommand: c.flow.state.testCommand ?? "npm test",
    planText: c.flow.state.planText ?? "",
    log: c.flow.state.buildLog ?? "",
    prev,
    final: round > 0,
    instruction: c.a.instruction,
  });
  const res = await callAgent(c, c.a.agent, prompt);
  const v = jsonBlock(res.text);
  const tag = `${need(c.flow.state.tag, "mã lượt")}v${round}`;
  const gaps = tasksOf(v.gaps, tag, devDomains(c), "verify");
  return { report: res.text, coverage: String(v.coverage ?? "?"), gaps };
}

export async function verifyStep(c: StepCtx): Promise<StepOut> {
  let prev = "";
  let last = { report: "", coverage: "?", gaps: [] as ReturnType<typeof tasksOf> };
  for (let round = 0; round <= c.a.rounds; round++) {
    last = await verifyOnce(c, round, prev);
    prev = last.report;
    if (last.gaps.length === 0 || round === c.a.rounds) break;
    await c.d.ws.enqueue(c.flow.project, last.gaps);
    const log = await drainQueue(c);
    await save(c, { buildLog: `${c.flow.state.buildLog ?? ""}${log}\n` });
  }
  await save(c, { verifyReport: last.report.slice(0, 60_000), coverage: last.coverage });
  const gaps = last.gaps.length;
  return out(
    c,
    gaps ? "gaps" : "done",
    `Độ phủ spec ${last.coverage}%${gaps ? `, còn ${gaps} khoảng trống` : ""}`,
  );
}
