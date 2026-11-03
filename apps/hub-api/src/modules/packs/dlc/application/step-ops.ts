// dlc-engine · bước DLC không gọi agent: `intake` (project workspace gắn hội thoại, ticket Trello ⇒ taken, spec đầu vào),
// `report` (báo cáo queue + nghiệm thu + git, lưu artifact, ticket ⇒ done = đã merge chờ deploy) và `deploy` (deploy bản đã
// merge; project chưa cấu hình deploy ⇒ bỏ qua có báo). Lớp 2.
import { reportText, runTag, specInput } from "../domain/dlc-prompts.rules";
import { fail, out, type StepCtx, type StepOut, save } from "./step-context";

export async function intakeStep(c: StepCtx): Promise<StepOut> {
  const f = c.flow;
  const project = await c.d.ws.upsertProject({
    key: f.project,
    title: f.project,
    conversationId: f.conversationId,
  });
  const ticket = f.ticketId ? await c.d.ws.ticket(f.ticketId) : null;
  if (f.ticketId && !ticket) fail(`không thấy ticket ${f.ticketId} trong workspace`);
  const files = f.mode === "new-system" ? await c.d.ws.specFiles(project) : "";
  const spec = specInput(f.mode, { ticket, files, requirement: f.requirement });
  await c.d.ws.putArtifact(project, "spec-input", `# Spec input\n\n${spec}`);
  if (ticket && f.ticketId)
    await c.d.ws.setTicket(f.ticketId, { status: "taken", projectKey: project });
  await save(c, { spec, tag: c.flow.state.tag ?? runTag(f.mode, f.id) });
  const src = ticket ? `ticket ${ticket.id}: ${ticket.name}` : "yêu cầu trong Chat";
  return out(c, "done", `Project ${project} · ${src}`);
}

export async function reportStep(c: StepCtx): Promise<StepOut> {
  const f = c.flow;
  const v = await c.d.ws.project(f.project);
  const text = reportText(f.mode, {
    project: f.project,
    queue: v.queue,
    summary: v.summary,
    log: f.state.buildLog ?? "",
    verify: f.state.verifyReport ?? "",
    coverage: f.state.coverage ?? "?",
    git: v.log,
    planText: f.state.planText ?? "",
  });
  await c.d.ws.putArtifact(f.project, "result", text);
  if (f.ticketId) await c.d.ws.setTicket(f.ticketId, { status: "done", projectKey: f.project });
  await save(c, { report: text });
  const s = v.summary;
  return out(
    c,
    Number(s.ready_to_deploy ?? 0) > 0 ? "ready_to_deploy" : "nothing_to_deploy",
    `${s.ready_to_deploy ?? 0} việc sẵn sàng deploy, ${s.failed ?? 0} lỗi; độ phủ spec ${f.state.coverage ?? "?"}%. Báo cáo: docs/dlc/result.md`,
  );
}

export async function deployStep(c: StepCtx): Promise<StepOut> {
  const r = await c.d.ws.deploy(c.flow.project);
  if (!r) return out(c, "skipped", `Project ${c.flow.project} chưa cấu hình deploy — bỏ qua`);
  await save(c, { deploy: { ok: r.ok, sha: r.sha, url: r.url, note: r.note.slice(-1500) } });
  if (!r.ok) fail(`deploy ${r.sha} lỗi: ${r.note.slice(-300)}`);
  return out(
    c,
    "deployed",
    `Đã deploy ${r.sha} (${r.tasks.length} việc)${r.url ? ` · ${r.url}` : ""}`,
  );
}
