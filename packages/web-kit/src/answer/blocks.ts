// C1 FE · F12 · tách markdown thành khối ở dòng trống (ngoài khối code) để memo khối đã đóng khi stream (plan-frontend §10).
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
// Dòng kế tiếp thụt vào hoặc là mục danh sách / trích dẫn → vẫn cùng khối (danh sách rời, đoạn lồng).
const CONTINUES = /^(\s|[-*+]\s|\d{1,9}[.)]\s|>)/;

/** Cập nhật trạng thái khối code (``` hoặc ~~~) sau khi đọc một dòng. */
function nextFence(fence: string | null, line: string): string | null {
  const marker = FENCE.exec(line)?.[1];
  if (!marker) return fence;
  if (fence === null) return marker;
  return marker[0] === fence[0] && marker.length >= fence.length ? null : fence;
}

/** Dòng trống này có kết thúc khối không (dòng kế tiếp không phải phần tiếp của danh sách/đoạn lồng). */
function endsBlock(lines: string[], i: number): boolean {
  const next = lines.slice(i + 1).find((l) => l.trim() !== "");
  return next !== undefined && !CONTINUES.test(next);
}

export function splitBlocks(content: string): string[] {
  const lines = content.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  for (const [i, line] of lines.entries()) {
    fence = nextFence(fence, line);
    current.push(line);
    if (fence === null && line.trim() === "" && endsBlock(lines, i)) {
      blocks.push(current.join("\n"));
      current = [];
    }
  }
  if (current.length > 0) blocks.push(current.join("\n"));
  return blocks;
}
