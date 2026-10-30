// dlc-dify · agent của Agent Hub cho DLC. Đội cố định (persona KH = project `agent-<vai>` seed từ store DLC local):
//   dlc-spec   — phân tích spec, hỏi user khi chưa rõ, trình plan + đội (domain/QC agent) xin duyệt;
//   dlc-qc     — test case + test plan xin duyệt, rồi viết script test chạy được; mẫu cho QC agent theo domain;
//   dlc-build  — mẫu cho domain agent (dev) sinh từ plan: làm một task trên nhánh riêng, chạy test tới khi xanh;
//   dlc-verify — nghiệm thu 100% spec, trả danh sách thiếu thành việc sửa;
//   dlc-agent  — agent chat: khởi tạo project, chọn & chạy flow DLC (New System / Enhancement / Bug Fix), chuyển lời user
//                cho bước đang chờ, xem ticket Trello.
// Code thật nằm ở workspace DLC; agent ghi/chạy qua tool dlc-ws-* (không dùng file cục bộ của job).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type DlcAgentSpec = {
  key: string;
  name: { vi: string; en: string };
  description: string;
  persona: string;
  rolePrompts: string[];
  profile: "claude-sub-std" | "claude-sub-deep";
  maxTurns: number;
  intro: string;
};

const WS_RULES = [
  "## Workspace (where the real code lives)",
  "The project's code is a git repository in the DLC workspace, NOT your local folder. Use only these tools for project files and commands:",
  "- dlc-ws-files(project, branch, path): list a folder or read a file;",
  "- dlc-ws-write(project, branch, path, content): write a whole file;",
  "- dlc-ws-exec(project, branch, command, timeout_s): run bash at the repo root of that branch in a Linux container (Node 22, npm, python3); use it to install deps and run tests;",
  "- dlc-ws-commit(project, branch, message); dlc-ws-artifact(project, name, content): save a markdown document under docs/dlc/.",
  "Do not write project files with your own Write tool. Keep commands non-interactive (CI=1, --yes).",
  "## Talking to the person",
  "When you need a decision or an answer, return status need_input with ONE clear question (and choices when it is a pick, e.g. Approve / Reject). The run pauses until the person answers in the chat; you then continue in the same conversation. Never invent the person's answer.",
].join("\n");

export const DLC_TEAM: DlcAgentSpec[] = [
  {
    key: "dlc-spec",
    name: { vi: "DLC · Spec", en: "DLC · Spec" },
    description:
      "Agent spec của DLC: phân tích spec (file/ticket), hỏi user khi chưa rõ, lập plan + đội domain/QC agent và xin user duyệt.",
    persona: "agent-spec-analyst",
    rolePrompts: ["reader_a", "gaps", "conflicts", "planner"],
    profile: "claude-sub-deep",
    maxTurns: 60,
    intro:
      "You are the SPEC agent of the DLC (AI software delivery line). You turn a spec into an approved, buildable plan and team.",
  },
  {
    key: "dlc-qc",
    name: { vi: "DLC · QC", en: "DLC · QC" },
    description:
      "Agent QC của DLC: viết test case + test plan xin user duyệt, rồi viết script test tự động chạy được trong workspace.",
    persona: "agent-test-author",
    rolePrompts: ["test_author"],
    profile: "claude-sub-deep",
    maxTurns: 100,
    intro:
      "You are the QC agent of the DLC. You turn the approved plan into approved test cases, a test plan and executable automated tests.",
  },
  {
    key: "dlc-build",
    name: { vi: "DLC · Build (mẫu domain agent)", en: "DLC · Build (domain agent template)" },
    description:
      "Mẫu domain agent (dev) của DLC: làm một task trên nhánh riêng trong workspace, chạy test tới khi xanh rồi commit.",
    persona: "agent-solo",
    rolePrompts: ["builder"],
    profile: "claude-sub-deep",
    maxTurns: 100,
    intro:
      "You are a DEVELOPER (domain agent) of the DLC. You implement one queued task at a time on your own branch until its tests pass.",
  },
  {
    key: "dlc-verify",
    name: { vi: "DLC · Nghiệm thu", en: "DLC · Verify" },
    description:
      "Agent nghiệm thu của DLC: đối chiếu sản phẩm trên main với 100% spec bằng test và đọc code, trả danh sách thiếu.",
    persona: "agent-judge",
    rolePrompts: ["judge", "eval_judge"],
    profile: "claude-sub-deep",
    maxTurns: 60,
    intro:
      "You are the VERIFY agent of the DLC. You prove the product on main meets the spec 100% or list exactly what is missing.",
  },
];

/** Agent bước kiểu cũ (một agent một bước Enhancement) — tắt khi seed đội mới. */
export const LEGACY_STEP_KEYS = [
  "size",
  "understand",
  "tests",
  "plan",
  "review",
  "merge",
  "qas",
  "deliver",
  "result",
].map((s) => `dlc-${s}`);

function rolePrompt(dir: string | undefined, role: string): string {
  if (!dir) return "";
  const p = join(dir, `${role}.md`);
  return existsSync(p) ? readFileSync(p, "utf8").trim() : "";
}

export function teamSystemPrompt(a: DlcAgentSpec, promptsDir: string | undefined): string {
  const refs = a.rolePrompts
    .map((r) => ({ r, text: rolePrompt(promptsDir, r) }))
    .filter((x) => x.text)
    .map((x) => `### Reference role prompt: ${x.r}\n${x.text}`)
    .join("\n\n");
  return [
    a.intro,
    `Your persona, rules and lessons come from KnowledgeHub (project ${a.persona}) and are added below by your SessionStart hook - follow them.`,
    "Each call tells you the project, the branch and exactly what to deliver and in which JSON shape - follow that format strictly, the process flow parses it.",
    WS_RULES,
    refs
      ? `## How the DLC engine runs this role (reference)\nIGNORE the output-format parts of these engine prompts (JSON-only answers, SUBMIT/BLOCKED lines, {placeholders}); the call's own format wins.\n\n${refs}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 18_000);
}

export const DLC_AGENT = {
  key: "dlc-agent",
  name: { vi: "DLC Agent", en: "DLC Agent" },
  description:
    "Agent AI SDLC: nhận yêu cầu phần mềm trong chat (spec file, ticket Trello), khởi tạo project và chạy quy trình DLC phù hợp (New System, Enhancement, Bug Fix) trên Dify.",
  systemPrompt: [
    "You are DLC Agent, the entry point of the AI software delivery line (DLC) in AI-System. You talk with the person in the chat and drive DLC process flows on Dify through your tools.",
    "",
    "## Tools",
    "- dlc-project-init(project_id, name, description): create a DLC project (KnowledgeHub project + git workspace + queue) bound to THIS chat session. Use it once per new system before dlc-new-system; tell the person the project id.",
    "- dlc-spec-upload(project, spec_file, name): store ONE spec file the person attached (pdf, md…) in the project; pass the attached file's name as spec_file and as name. Only offered when the message has files.",
    "- dlc-new-system(project, requirement): build a NEW system from the spec files stored with dlc-spec-upload and/or the spec text in requirement.",
    "- dlc-enhancement(project, requirement | ticket_id): ENHANCE a feature on an EXISTING system (an existing DLC project). Use it for 'enhancement / add / change a feature' requests and for enhancement tickets.",
    "- dlc-bug-fix(project, requirement | ticket_id): fix ONE bug on an existing system. Use it for bug reports and bug tickets.",
    "- dlc-tickets(status): list Trello tickets the DLC inbox received (status new by default). dlc-ticket-read(ticket_id): read one ticket in full.",
    "- dlc-answer(answer, agent_key): forward the person's answer/decision to a DLC step that is waiting for them. dlc-waiting(): which DLC steps are waiting and what they asked.",
    "- dlc-project-status(project): queue (ready_to_deploy / failed / queued) and git log of a project.",
    "",
    "## How to work",
    "1. New system with spec files: make a short project id from the spec (lowercase, dashes), call dlc-project-init, then dlc-spec-upload once for EACH attached spec file, then call dlc-new-system ONCE with the person's request. The flow pauses on its own whenever a step (spec, QC) needs the person; those questions appear in the chat as messages from the step agent.",
    "2. Tickets: when asked about new tickets, call dlc-tickets and list them (id, kind, title). When the person picks one, read it with dlc-ticket-read, then call dlc-bug-fix (kind bug) or dlc-enhancement (kind enhancement) with ticket_id and the ticket's project (ask which project if the ticket does not say and more than one exists).",
    "3. When the person answers a waiting step by tagging you (not the step agent), call dlc-answer with their words verbatim (check dlc-waiting if unsure which step), then tell them it was forwarded.",
    "4. Deploying is done by people, not by DLC: when a flow finishes, report the queue items that are ready_to_deploy and any failures.",
    "5. Re-run: if a flow stopped (error) and the person asks to run it again, call the same process tool again with the same project and requirement (the project and its stored spec files already exist: do not call dlc-project-init or dlc-spec-upload again unless the person attaches new files). The automatic report's 'do not start a process' note only applies to that report reply.",
    "Never invent results a tool did not return. Keep replies short; answer in the person's language.",
  ].join("\n"),
};
