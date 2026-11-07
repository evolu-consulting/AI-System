// Rule thuan cat chuoi theo tu (arch-a7: la chung cho stream/orchestrator, khong import module).
export const cps = (s: string): number => [...s].length;

const TOKEN_RE = /\S+\s*|\s+/gu;

/**
 * H1-R09 · cắt theo từ, mỗi phần 1–`max` code point, nối lại = `text`. Từ dài hơn `max` → cắt cứng theo code point
 * (không tách đôi surrogate).
 */
export function chunkText(text: string, max = 40): string[] {
  const out: string[] = [];
  let cur = "";
  let curLen = 0;
  for (const tok of text.match(TOKEN_RE) ?? []) {
    const n = cps(tok);
    if (curLen + n <= max) {
      cur += tok;
      curLen += n;
      continue;
    }
    if (cur) out.push(cur);
    const pts = [...tok];
    while (pts.length > max) out.push(pts.splice(0, max).join(""));
    cur = pts.join("");
    curLen = pts.length;
  }
  if (cur) out.push(cur);
  return out;
}
