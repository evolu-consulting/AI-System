import { describe, expect, test } from "bun:test";
import {
  decide,
  extractWriteTargets,
  type GuardOptions,
  type HookInput,
  resolvePath,
} from "./guard-worktree.rules";

const MAIN = "F:\\workspace\\evolu-platform";
const WT = "F:\\workspace\\evolu-wt\\tool-hook";
const opts: GuardOptions = { mainRoot: MAIN };

const sub = (tool_name: string, tool_input: Record<string, unknown>, cwd = WT): HookInput => ({
  agent_id: "agent-1",
  agent_type: "general-purpose",
  cwd,
  tool_name,
  tool_input,
});
const denied = (i: HookInput, o = opts) => decide(i, o).deny;

describe("tool-hook · Write/Edit/NotebookEdit", () => {
  test("subagent ghi checkout chính → chặn (mọi kiểu đường dẫn)", () => {
    for (const p of [
      `${MAIN}\\apps\\x.ts`,
      "F:/workspace/evolu-platform/apps/x.ts",
      "f:\\WORKSPACE\\Evolu-Platform\\index.ts",
      "/f/workspace/evolu-platform/viewer.ts",
      `${WT}\\..\\..\\evolu-platform\\a.ts`,
    ])
      expect(denied(sub("Write", { file_path: p }))).toBe(true);
    expect(denied(sub("Edit", { file_path: `${MAIN}\\a.ts` }))).toBe(true);
    expect(denied(sub("NotebookEdit", { notebook_path: `${MAIN}\\a.ipynb` }))).toBe(true);
  });

  test("đường dẫn tương đối tính theo cwd: cwd=checkout chính → chặn, cwd=worktree → cho qua", () => {
    expect(denied(sub("Write", { file_path: "index.ts" }, MAIN))).toBe(true);
    expect(denied(sub("Write", { file_path: "index.ts" }, WT))).toBe(false);
  });

  test("subagent ghi worktree / scratchpad / .claude/worktrees → cho qua", () => {
    expect(denied(sub("Write", { file_path: `${WT}\\apps\\x.ts` }))).toBe(false);
    expect(
      denied(
        sub("Write", { file_path: "C:\\Users\\Admin\\AppData\\Local\\Temp\\claude\\s\\a.md" }),
      ),
    ).toBe(false);
    expect(denied(sub("Edit", { file_path: `${MAIN}\\.claude\\worktrees\\s1\\a.ts` }))).toBe(false);
    expect(denied(sub("Write", { file_path: "F:\\workspace\\evolu-platform-other\\a.ts" }))).toBe(
      false,
    );
  });
});

describe("tool-hook · nhận diện subagent", () => {
  test("phiên chính (không có agent_id) ghi checkout chính → cho qua", () => {
    const main: HookInput = {
      cwd: MAIN,
      tool_name: "Write",
      tool_input: { file_path: `${MAIN}\\a.ts` },
    };
    expect(denied(main)).toBe(false);
    expect(denied({ ...main, agent_id: "" })).toBe(false);
    // chỉ có agent_type (phiên chạy --agent) vẫn là phiên chính
    expect(denied({ ...main, agent_type: "reviewer" })).toBe(false);
  });

  test("agent_type trong danh sách cho phép → cho qua", () => {
    const i = sub("Write", { file_path: `${MAIN}\\a.ts` });
    expect(denied(i, { ...opts, allowAgentTypes: ["general-purpose"] })).toBe(false);
  });

  test("lý do chặn nêu đường dẫn worktree để agent tự sửa", () => {
    const d = decide(sub("Write", { file_path: `${MAIN}\\a.ts` }), opts);
    expect(d.deny && d.reason).toContain("evolu-wt");
  });
});

describe("tool-hook · PowerShell/Bash ghi qua chuyển hướng", () => {
  const cmd = (command: string, cwd = WT, tool = "PowerShell") => sub(tool, { command }, cwd);

  test("chặn: chuyển hướng / cmdlet / .NET File API vào checkout chính", () => {
    for (const c of [
      `"x" > ${MAIN}\\index.ts`,
      `echo x >> F:/workspace/evolu-platform/viewer.ts`,
      `Get-Date | Out-File ${MAIN}\\approval.repo.ts`,
      `Set-Content -Path "${MAIN}\\a.ts" -Value 'x'`,
      `Set-Content -Encoding utf8 -Value 'x' -LiteralPath '${MAIN}\\a.ts'`,
      `Add-Content ${MAIN}\\a.ts "x"`,
      `[IO.File]::WriteAllText("${MAIN}\\a.ts", "x")`,
      `[System.IO.File]::AppendAllText('${MAIN}\\a.ts','x')`,
      `echo hi | tee ${MAIN}/a.txt`,
    ])
      expect(denied(cmd(c))).toBe(true);
  });
});

describe("tool-hook · PowerShell/Bash đích tương đối và cho qua", () => {
  const cmd = (command: string, cwd = WT, tool = "PowerShell") => sub(tool, { command }, cwd);

  test("chặn: đích tương đối khi cwd là checkout chính (lỗi gốc: file 0 byte ở gốc repo)", () => {
    expect(denied(cmd("echo x > index.ts", MAIN))).toBe(true);
    expect(denied(cmd("echo x > viewer.ts", MAIN, "Bash"))).toBe(true);
    expect(denied(cmd("echo x > index.ts", WT))).toBe(false);
  });

  test("cho qua: $null, /dev/null, temp, scratchpad, worktree, biến", () => {
    for (const c of [
      "bun test 2>$null",
      "bun test > $null",
      "bun test > /dev/null 2>&1",
      "bun test > NUL",
      `bun test 2>&1 | Out-File C:\\Users\\Admin\\AppData\\Local\\Temp\\claude\\s\\out.txt`,
      `Set-Content -Path $env:TEMP\\a.txt -Value x`,
      `bun test > ${WT}\\out.txt`,
      `echo x > ${MAIN}\\.claude\\worktrees\\s1\\o.txt`,
      `[IO.File]::WriteAllText($p, "x")`,
    ])
      expect(denied(cmd(c, MAIN))).toBe(false);
  });

  test("ít dương tính giả: chữ trong chuỗi trích dẫn, heredoc, =>, ->, so sánh", () => {
    for (const c of [
      `git commit -m "chan > ${MAIN}\\a.ts va Out-File ${MAIN}\\b.ts"`,
      `git commit -m 'Set-Content ${MAIN}\\a.ts'`,
      'bun -e "const f = (x) => x > 1"',
      "echo a->b",
      `cat <<'EOF'\nx > ${MAIN}\\a.ts\nEOF`,
      "Get-Content a.txt | Select-Object -First 3",
      "git diff --stat 2>&1 | Select-Object -Last 5",
    ])
      expect(denied(cmd(c, MAIN))).toBe(false);
  });

  test("phiên chính chuyển hướng vào checkout chính → cho qua", () => {
    const i: HookInput = {
      cwd: MAIN,
      tool_name: "Bash",
      tool_input: { command: `echo x > ${MAIN}\\a.ts` },
    };
    expect(denied(i)).toBe(false);
  });
});

describe("tool-hook · hàm phụ", () => {
  test("resolvePath gọn .. và chuẩn hoá", () => {
    expect(resolvePath("..\\a.ts", "F:\\x\\y")).toBe("f:/x/a.ts");
    expect(resolvePath("F:/A/./b", "C:/")).toBe("f:/a/b");
  });
  test("extractWriteTargets lấy đích có dấu nháy và bỏ 2>&1", () => {
    expect(extractWriteTargets(`echo x > "F:\\a b\\c.txt" 2>&1`)).toEqual(["F:\\a b\\c.txt"]);
  });
});
