// dlc-dify · cổng test khi merge một việc vào `main` (luật thuần, không I/O). QC viết TOÀN BỘ test trước (TDD) nên việc đầu
// (vd khung dự án) không thể làm xanh cả bộ: đạt khi lệnh test thoát 0, HOẶC không thụt lùi so với `main` trước merge (số
// test đạt không giảm, số test lỗi không tăng). Không đọc được số liệu ⇒ chỉ đạt khi thoát 0.

export type TestCounts = { passed: number; failed: number };
export type TestRun = { exit: number; counts: TestCounts | null };

const num = (re: RegExp, s: string): number | null => {
  const m = re.exec(s);
  return m ? Number(m[1]) : null;
};

function fromLine(line: string): TestCounts | null {
  const passed = num(/(\d+)\s+passed/, line);
  const failed = num(/(\d+)\s+failed/, line);
  if (passed === null && failed === null) return null;
  return { passed: passed ?? 0, failed: failed ?? 0 };
}

/** Đếm test từ output: Jest/Vitest (`Tests: …`), node:test (`# pass N` / `# fail N`), pytest (dòng tổng kết cuối). */
export function testCounts(output: string): TestCounts | null {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: bỏ mã màu ANSI của output test
  const plain = output.replace(/\x1b\[[0-9;]*m/g, "");
  const lines = plain.split(/\r?\n/);
  const jest = lines.filter((l) => /^\s*Tests:\s/.test(l)).pop();
  if (jest) return fromLine(jest);
  const pass = [...plain.matchAll(/^# pass (\d+)$/gm)].pop();
  const fail = [...plain.matchAll(/^# fail (\d+)$/gm)].pop();
  if (pass || fail) return { passed: Number(pass?.[1] ?? 0), failed: Number(fail?.[1] ?? 0) };
  for (const l of lines.reverse()) {
    const c = fromLine(l);
    if (c) return c;
  }
  return null;
}

/** Đạt cổng merge? `base` = lần chạy trên `main` trước merge (null = không có). */
export function gateOk(base: TestRun | null, after: TestRun): boolean {
  if (after.exit === 0) return true;
  if (!base?.counts || !after.counts) return false;
  return after.counts.passed >= base.counts.passed && after.counts.failed <= base.counts.failed;
}

export function describeRun(r: TestRun): string {
  return r.counts
    ? `exit=${r.exit}, ${r.counts.passed} passed, ${r.counts.failed} failed`
    : `exit=${r.exit}`;
}
