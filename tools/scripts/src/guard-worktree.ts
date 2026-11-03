// tool-hook · hook PreToolUse (Write|Edit|NotebookEdit|PowerShell|Bash): chặn SUBAGENT ghi vào checkout chính ngoài worktree của lát.
// Cài ở .claude/settings.json dạng exec (`command: "bun"`, `args: [...]`) — không qua shell, nên chạy được cả khi máy không có Git Bash
// (khi đó hook dạng shell chạy bằng PowerShell và cú pháp `|| true` làm hook lỗi → có thể chặn mọi tool).
// Env: EVOLU_MAIN_ROOT (mặc định F:/workspace/evolu-platform) · EVOLU_GUARD_OFF=1 (tắt) · EVOLU_GUARD_ALLOW_AGENTS=a,b (agent_type được ghi).
// Lỗi bất kỳ → không chặn (fail-open): hook không được làm hỏng công việc.
import { decide, type HookInput } from "./guard-worktree.rules";

const DEFAULT_MAIN_ROOT = "F:/workspace/evolu-platform";

async function main(): Promise<void> {
  if (process.env.EVOLU_GUARD_OFF === "1") return;
  const input = JSON.parse(await Bun.stdin.text()) as HookInput;
  const allow = (process.env.EVOLU_GUARD_ALLOW_AGENTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const d = decide(input, {
    mainRoot: process.env.EVOLU_MAIN_ROOT || DEFAULT_MAIN_ROOT,
    allowAgentTypes: allow,
  });
  if (!d.deny) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: d.reason,
      },
    }),
  );
}

await main().catch((e) => process.stderr.write(`guard-worktree: ${String(e)}\n`)); // fail-open; stderr bị hook bỏ (2>/dev/null)
