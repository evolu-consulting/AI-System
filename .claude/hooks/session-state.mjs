// SessionStart: chèn tóm tắt docs/STATE.md để phiên mới biết bối cảnh (không chạy gì khác).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
try {
  const text = readFileSync(join(dir, 'docs', 'STATE.md'), 'utf8');
  const cut = text.split('\n## Độ phủ')[0].split('\n').slice(0, 40).join('\n');
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '[session-state] Tóm tắt docs/STATE.md:\n' + cut } }));
} catch {}
