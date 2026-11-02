// dlc-engine · lời giao việc cho agent của từng bước DLC + đọc kết quả (khối ```json cuối) — chuyển từ node code Python của flow
// Dify cũ (`tools/dlc-dify/process-design.ts`, `process-build.ts`). Khác flow cũ: agent KHÔNG tự xin "Approve/Reject" — cổng duyệt
// của bước do engine giữ (Đạt / Chưa đạt + góp ý / quay lại bước trước); agent vẫn hỏi người khi chưa rõ (need_input). Thuần, lớp 1.
import type { DlcMode } from "./dlc-flow.rules";

export const clip = (s: string | null | undefined, n: number): string => {
  const t = s ?? "";
  return t.length <= n ? t : `${t.slice(0, n)}\n...(truncated)`;
};

/** Khối ```json CUỐI cùng parse được; không có ⇒ thử cả chuỗi; hỏng ⇒ {}. */
export function jsonBlock(text: string | null | undefined): Record<string, unknown> {
  const t = text ?? "";
  const blocks = [...t.matchAll(/```json\s*([\s\S]*?)```/g)].map((m) => m[1] ?? "");
  for (const b of blocks.reverse()) {
    try {
      const v = JSON.parse(b) as unknown;
      if (typeof v === "object" && v !== null && !Array.isArray(v))
        return v as Record<string, unknown>;
    } catch {
      /* thử khối trước */
    }
  }
  try {
    const v = JSON.parse(t) as unknown;
    return typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export const RULES_TOOLS =
  "Workspace tools (MCP): dlc-ws-files (list/read), dlc-ws-write (write a file), dlc-ws-exec (run a shell command in a Linux container with Node 22 + npm + python3, cwd = repo root of the branch), dlc-ws-commit, dlc-ws-artifact (save a markdown artifact under docs/dlc/). Always pass `project` and `branch`.";

const TITLE: Readonly<Record<DlcMode, string>> = {
  "new-system": "New System",
  enhancement: "Enhancement",
  "bug-fix": "Bug Fix",
};
export const modeTitle = (m: DlcMode): string => TITLE[m];

const SPEC_TASK: Readonly<Record<DlcMode, string>> = {
  "new-system": "Design a NEW system from the spec below (empty repository).",
  enhancement:
    "Design ONE enhancement on the EXISTING system in the workspace: read the current code first (dlc-ws-files on branch main) and change only what the request needs.",
  "bug-fix":
    "Design the fix of ONE bug on the EXISTING system in the workspace: read the current code first (dlc-ws-files on branch main), find the root cause, and plan the smallest correct fix plus a regression test.",
};

/** Mã lượt chạy (tiền tố id việc trong queue — một queue / project, không trùng giữa các lượt). */
export function runTag(mode: DlcMode, processRunId: string): string {
  const p = mode === "new-system" ? "ns" : mode === "enhancement" ? "en" : "bf";
  return p + processRunId.replace(/-/g, "").slice(-6);
}

/** Khoá project workspace từ tên/ticket (`[a-z0-9-]`, ≤ 48). */
export function projectKeyOf(raw: string): string {
  const k = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return k || "project";
}

export type Ticket = { id: string; kind: string; name: string; url?: string; desc?: string };

/** Spec đầu vào: ticket + (New System) file spec đã lưu + lời người yêu cầu. */
export function specInput(
  mode: DlcMode,
  o: { ticket: Ticket | null; files: string; requirement: string },
): string {
  const parts: string[] = [];
  const t = o.ticket;
  if (t)
    parts.push(
      `## Trello ticket ${t.id} (${t.kind}): ${t.name}\n${t.url ?? ""}\n\n${t.desc ?? ""}`,
    );
  if (mode === "new-system" && o.files.trim()) parts.push(o.files.trim());
  if (o.requirement.trim()) parts.push(`## Request from the person\n${o.requirement.trim()}`);
  return clip(parts.join("\n\n") || "(empty spec)", 150_000);
}

const review = (feedback: string | null, prev: string): string =>
  feedback?.trim()
    ? `## THE REVIEWER SENT THIS STEP BACK - fix this first\n${feedback.trim()}\n\n${prev ? `## Your previous result\n${clip(prev, 20_000)}\n\n` : ""}`
    : "";
const extra = (instruction: string): string =>
  instruction.trim()
    ? `## Extra instruction from the process owner\n${instruction.trim()}\n\n`
    : "";

export function specPrompt(
  mode: DlcMode,
  o: { project: string; spec: string; feedback: string | null; prev: string; instruction: string },
): string {
  return (
    `DLC ${TITLE[mode]} - SPEC step. Project \`${o.project}\` (workspace branch main).\n${SPEC_TASK[mode]}\n\n${RULES_TOOLS}\n\n` +
    "Do this in order:\n" +
    "1. Analyse the spec. If anything is unclear, missing or contradictory, ASK the person (status need_input, one focused question; give choices when useful). You may ask several times; wait for each answer.\n" +
    "2. When it is clear, write the implementation PLAN and the TEAM: domain agents (dev, one per domain, e.g. backend, frontend) and QC agents (one per domain). Do NOT ask for approval: the process has an approval gate after this step.\n" +
    "3. Save the plan with dlc-ws-artifact (name plan), then answer status done with the whole plan + team in Markdown and ONE ```json block:\n" +
    '{"stack": "...", "test_command": "<one command that runs the whole automated test suite from the repo root, non-interactive>", ' +
    '"tasks": [{"id": "t1", "title": "...", "domain": "backend", "detail": "...", "acceptance": "..."}], ' +
    '"domains": [{"domain": "backend", "name": "...", "focus": "..."}], "qc": [{"domain": "backend", "name": "...", "focus": "..."}]}\n' +
    "Rules: the stack must run in Node 22 / npm / python3 on Linux; small tasks in build order (each builds on the earlier ones); every spec item maps to at least one task; task.domain is one of domains.\n\n" +
    review(o.feedback, o.prev) +
    extra(o.instruction) +
    `## Spec\n${o.spec}`
  );
}

export function qcPrompt(
  mode: DlcMode,
  o: {
    project: string;
    spec: string;
    plan: string;
    planText: string;
    feedback: string | null;
    prev: string;
    instruction: string;
  },
): string {
  return (
    `DLC ${TITLE[mode]} - QC step. Project \`${o.project}\` (workspace branch main).\n${RULES_TOOLS}\n\n` +
    "Do this in order:\n" +
    "1. From the APPROVED plan and the spec, write the TEST CASES (one or more per acceptance point, id, steps, expected) and the TEST PLAN (levels, tools, how to run).\n" +
    "2. If you find the SPEC/PLAN itself is wrong (contradiction, impossible, missing core behaviour), say so clearly at the top of your answer with the reason: the reviewer can send the process back to the spec step.\n" +
    "3. Write EXECUTABLE automated tests into the workspace (branch main) with dlc-ws-write so that the plan's test_command runs them all (create package.json / config / test runner as needed). Tests must exist for every acceptance point; they fail now because nothing is implemented yet - that is expected. Run the test command once with dlc-ws-exec to prove the suite executes, commit with dlc-ws-commit, save the test plan with dlc-ws-artifact (name test-plan).\n" +
    "4. Do NOT ask for approval (the process has an approval gate after this step). Answer status done with the test cases + test plan in Markdown and ONE ```json block: " +
    '{"test_command": "...", "test_files": ["..."], "cases": <number>, "spec_problem": "<empty, or why the spec must be redone>"}\n\n' +
    review(o.feedback, o.prev) +
    extra(o.instruction) +
    `## Approved plan\n${clip(o.planText, 40_000)}\n\n## Plan JSON\n${clip(o.plan, 30_000)}\n\n## Spec\n${clip(o.spec, 60_000)}`
  );
}

export type QueueItem = {
  id: string;
  title?: string;
  domain?: string;
  branch?: string;
  detail?: string;
  acceptance?: string;
  notes?: string[];
  status?: string;
  attempts?: number;
  source?: string;
};

export function buildPrompt(o: {
  project: string;
  item: QueueItem;
  testCommand: string;
  planText: string;
}): string {
  const it = o.item;
  const notes = (it.notes ?? []).join("\n");
  const cmd = o.testCommand || "npm test";
  return (
    `DLC build. Project \`${o.project}\`. Your branch: \`${it.branch ?? ""}\` (made from main; it already holds the approved automated tests).\n${RULES_TOOLS}\n\n` +
    `Task ${it.id}: ${it.title ?? ""} (domain ${it.domain ?? ""})\n\n## Detail\n${it.detail ?? ""}\n\n## Acceptance\n${it.acceptance ?? ""}\n\n` +
    `Implement ONLY this task on your branch: read the existing code (dlc-ws-files), write the code (dlc-ws-write), run \`${cmd}\` on your branch with dlc-ws-exec and iterate until the tests for this task pass and no earlier passing test breaks. ` +
    "Merge gate: after merging your branch into main the suite must pass in full, OR have no more failing and no fewer passing tests than main before the merge; tests of LATER tasks may still fail, do not implement later tasks early. If main already does everything this task asks, change nothing and say so. " +
    "Install dependencies through the project files (package.json) so the test command works from a clean checkout. Do not weaken or delete tests; fix a test only for a real defect and say so. Commit with dlc-ws-commit. " +
    'Answer status done with a short summary and ```json {"done": true, "summary": "..."}```.\n' +
    (notes ? `\n## PREVIOUS ATTEMPTS FAILED - fix this first\n${notes.slice(-6000)}\n` : "") +
    `\n## Approved plan (context)\n${clip(o.planText, 15_000)}`
  );
}

export function verifyPrompt(
  mode: DlcMode,
  o: {
    project: string;
    spec: string;
    testCommand: string;
    planText: string;
    log: string;
    prev: string;
    final: boolean;
    instruction: string;
  },
): string {
  const cmd = o.testCommand || "npm test";
  const head = o.final
    ? `DLC ${TITLE[mode]} - FINAL VERIFY after the fix round. Project \`${o.project}\`, branch main.\n${RULES_TOOLS}\n\nThe previous verification found gaps; fix tasks were built and merged (log below). Check again item by item: `
    : `DLC ${TITLE[mode]} - VERIFY step. Project \`${o.project}\`, branch main (all tasks merged).\n${RULES_TOOLS}\n\nCheck the product against the spec item by item (target 100%): `;
  return (
    head +
    `run \`${cmd}\` on main with dlc-ws-exec, read the code, and map EVERY spec item / acceptance point to evidence (test name + result, or file). ` +
    "Save the report with dlc-ws-artifact (name verification). Answer status done with the report and ONE ```json block: " +
    '{"coverage": <0-100>, "tests_pass": true|false, "gaps": [{"id": "fix1", "title": "...", "domain": "...", "detail": "...", "acceptance": "..."}]} ' +
    "- gaps = every missing/incorrect behaviour or failing test, as fix tasks for the dev agents (empty list when 100%).\n\n" +
    extra(o.instruction) +
    `## Build log\n${clip(o.log, 8000)}\n\n` +
    (o.prev ? `## Previous verification\n${clip(o.prev, 15_000)}\n\n` : "") +
    `## Approved plan\n${clip(o.planText, 20_000)}\n\n## Spec\n${clip(o.spec, 60_000)}`
  );
}

export function agentPrompt(
  mode: DlcMode,
  o: {
    project: string;
    instruction: string;
    spec: string;
    planText: string;
    feedback: string | null;
    prev: string;
  },
): string {
  return (
    `DLC ${TITLE[mode]} - custom step. Project \`${o.project}\` (workspace branch main).\n${RULES_TOOLS}\n\n` +
    `## Your task\n${o.instruction.trim() || "(no instruction)"}\n\n` +
    "Ask the person when something is unclear (status need_input). Answer status done with your result in Markdown.\n\n" +
    review(o.feedback, o.prev) +
    (o.planText ? `## Approved plan (context)\n${clip(o.planText, 15_000)}\n\n` : "") +
    `## Spec\n${clip(o.spec, 40_000)}`
  );
}

const slug = (s: unknown, n: number): string =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, n);

export type TeamAgent = { domain: string; name: string; focus: string };

/** Đội từ plan đã duyệt: dev theo domain (thiếu ⇒ một dev chung), QC `qc-<domain>`. */
export function teamOf(plan: Record<string, unknown>): { dev: TeamAgent[]; qc: TeamAgent[] } {
  const list = (x: unknown): TeamAgent[] =>
    (Array.isArray(x) ? x : []).slice(0, 12).flatMap((a) => {
      const o = (a ?? {}) as Record<string, unknown>;
      const d = slug(o.domain, 20);
      return d
        ? [
            {
              domain: d,
              name: String(o.name ?? d).slice(0, 80),
              focus: String(o.focus ?? "").slice(0, 8000),
            },
          ]
        : [];
    });
  const dev = list(plan.domains);
  const qc = list(plan.qc).map((a) => ({ ...a, domain: `qc-${a.domain}`.slice(0, 24) }));
  return {
    dev: dev.length ? dev : [{ domain: "dev", name: "Developer", focus: "Implements every task." }],
    qc,
  };
}

/** Việc queue từ plan / khoảng trống nghiệm thu (id có mã lượt; domain lạ ⇒ dev đầu tiên). */
export function tasksOf(
  raw: unknown,
  tag: string,
  devDomains: readonly string[],
  source: "plan" | "verify",
): QueueItem[] {
  return (Array.isArray(raw) ? raw : []).map((t, i) => {
    const o = (t ?? {}) as Record<string, unknown>;
    const d = slug(o.domain, 20);
    const pfx = source === "plan" ? "t" : "fix";
    return {
      id: `${tag}-${String(o.id ?? `${pfx}${i + 1}`).slice(0, 30)}`,
      title: String(o.title ?? (source === "plan" ? "task" : "fix")).slice(0, 300),
      domain: devDomains.includes(d) ? d : (devDomains[0] ?? "dev"),
      detail: String(o.detail ?? "").slice(0, 20_000),
      acceptance: String(o.acceptance ?? "").slice(0, 20_000),
      source,
    };
  });
}

/** Agent domain của việc: `dlc-<project>-<domain>` nếu đã sinh, không thì agent sinh đầu tiên / `dlc-build`. */
export function domainAgentOf(project: string, domain: string, spawned: readonly string[]): string {
  const k = `dlc-${project}-${domain}`
    .replace(/[^a-z0-9-]+/g, "-")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return spawned.includes(k) ? k : (spawned[0] ?? "dlc-build");
}

export function reportText(
  mode: DlcMode,
  o: {
    project: string;
    queue: QueueItem[];
    summary: Record<string, unknown>;
    log: string;
    verify: string;
    coverage: string;
    git: string;
    planText: string;
  },
): string {
  const rows = o.queue
    .map(
      (x) =>
        `| ${x.id} | ${(x.title ?? "").slice(0, 60)} | ${x.domain ?? ""} | ${x.status ?? ""} | ${x.attempts ?? 0} |`,
    )
    .join("\n");
  const s = o.summary;
  return clip(
    `# DLC ${TITLE[mode]} - project ${o.project}\n\n` +
      `**Queue:** ${s.ready_to_deploy ?? 0} ready to deploy, ${s.failed ?? 0} failed, ${s.queued ?? 0} still queued (of ${s.total ?? 0}). ` +
      `**Spec coverage (verify):** ${o.coverage}%. Approve the next gate to deploy the merged items (ready_to_deploy = merged on main, tests passing).\n\n` +
      `| task | title | domain | status | attempts |\n|---|---|---|---|---|\n${rows}\n\n` +
      `## Build log\n${o.log}\n\n## Verification\n${clip(o.verify, 20_000)}\n\n## Git (main)\n\`\`\`\n${o.git}\n\`\`\`\n\n` +
      `<details><summary>Approved plan</summary>\n\n${clip(o.planText, 20_000)}\n</details>`,
    150_000,
  );
}
