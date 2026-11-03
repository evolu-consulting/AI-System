// dlc-engine · bước DLC do MỘT agent làm (spec, QC, agent tuỳ ý): dựng lời giao việc từ trạng thái lượt, gọi agent trong hội
// thoại (agent hỏi người ⇒ chờ), đọc khối ```json, ghi trạng thái. Người duyệt ở cổng của stage (engine); Chưa đạt ⇒ engine chạy
// lại bước với góp ý (`feedback`). Lớp 2.
import { agentPrompt, jsonBlock, qcPrompt, specPrompt } from "../domain/dlc-prompts.rules";
import {
  callAgent,
  fail,
  need,
  out,
  type StepCtx,
  type StepOut,
  save,
  withDialog,
  withResult,
} from "./step-context";

const prevOf = (c: StepCtx): string => (c.feedback ? (c.flow.state.results?.[c.a.step] ?? "") : "");

export async function specStep(c: StepCtx): Promise<StepOut> {
  const spec = need(c.flow.state.spec, "spec đầu vào (bước khởi tạo)");
  const prompt = specPrompt(c.a.mode, {
    project: c.flow.project,
    spec,
    feedback: c.feedback,
    prev: prevOf(c),
    instruction: c.a.instruction,
  });
  const res = await callAgent(c, c.a.agent, prompt);
  const plan = jsonBlock(res.text);
  const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
  if (tasks.length === 0) fail("agent spec không trả plan JSON có `tasks`");
  const planText = withDialog(res, 40_000);
  const testCommand =
    typeof plan.test_command === "string" && plan.test_command ? plan.test_command : "npm test";
  await save(c, { plan, planText, testCommand, ...withResult(c, res.text) });
  const domains = Array.isArray(plan.domains) ? plan.domains.length : 0;
  return out(c, "done", `Plan: ${tasks.length} task, ${domains} domain; test: ${testCommand}`);
}

export async function qcStep(c: StepCtx): Promise<StepOut> {
  const plan = need(c.flow.state.plan, "plan (bước spec)");
  const prompt = qcPrompt(c.a.mode, {
    project: c.flow.project,
    spec: need(c.flow.state.spec, "spec đầu vào"),
    plan: JSON.stringify(plan),
    planText: c.flow.state.planText ?? "",
    feedback: c.feedback,
    prev: prevOf(c),
    instruction: c.a.instruction,
  });
  const res = await callAgent(c, c.a.agent, prompt);
  const q = jsonBlock(res.text);
  const cmd =
    typeof q.test_command === "string" && q.test_command
      ? q.test_command
      : c.flow.state.testCommand;
  await save(c, { testCommand: cmd ?? "npm test", ...withResult(c, res.text) });
  const problem = typeof q.spec_problem === "string" ? q.spec_problem.trim() : "";
  const cases = typeof q.cases === "number" ? q.cases : "?";
  if (problem) return out(c, "spec_problem", `QC đề nghị làm lại spec: ${problem}`);
  return out(c, "done", `${cases} test case; test: ${cmd ?? "npm test"}`);
}

export async function agentStep(c: StepCtx): Promise<StepOut> {
  const prompt = agentPrompt(c.a.mode, {
    project: c.flow.project,
    instruction: c.a.instruction,
    spec: c.flow.state.spec ?? c.flow.requirement,
    planText: c.flow.state.planText ?? "",
    feedback: c.feedback,
    prev: prevOf(c),
  });
  const res = await callAgent(c, c.a.agent, prompt);
  await save(c, withResult(c, withDialog(res, 40_000)));
  return out(c, "done", res.text.slice(0, 600));
}
