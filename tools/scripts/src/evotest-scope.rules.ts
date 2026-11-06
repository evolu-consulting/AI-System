// Chốt phạm vi evotest cho lát (luật 5d/D4): worktree lát không được chạy rộng. Hàm thuần — CLI ở evotest-scope.ts.
export const MAX_INT_FILES = 30;
export const MAX_E2E_JOBS = 3;
export const MAX_E2E_SPECS = 60;

export type ScopeInput = {
  /** Chạy từ worktree lát (đường dẫn dưới `evolu-wt` hoặc nhánh `slice/*`). */
  slice: boolean;
  /** `-Wave` / `EVOTEST_WAVE=1`: điều phối chạy wave, bỏ chốt. */
  wave: boolean;
  hasFilter: boolean;
  intFiles: number;
  e2eJobs: number;
  e2eSpecs: number;
};

export type ScopeVerdict = { allow: true } | { allow: false; reason: string };

const HOW =
  "thu hẹp: -Filter <đường/dẫn/file.int.test.ts> (int) hoặc -Filter <tên job> (e2e); wave do điều phối chạy (-Wave)";

export function decideScope(i: ScopeInput): ScopeVerdict {
  if (!i.slice || i.wave) return { allow: true };
  const block = (why: string): ScopeVerdict => ({ allow: false, reason: `${why}; ${HOW}` });
  if (!i.hasFilter) return block("lát không được chạy toàn bộ (không có -Filter)");
  if (i.intFiles > MAX_INT_FILES) return block(`${i.intFiles} file int > ${MAX_INT_FILES}`);
  if (i.e2eJobs > MAX_E2E_JOBS) return block(`${i.e2eJobs} job e2e > ${MAX_E2E_JOBS}`);
  if (i.e2eSpecs > MAX_E2E_SPECS) return block(`${i.e2eSpecs} spec e2e > ${MAX_E2E_SPECS}`);
  return { allow: true };
}

export const scopeLine = (i: Pick<ScopeInput, "intFiles" | "e2eJobs" | "e2eSpecs">): string =>
  `phạm vi: ${i.intFiles} file int / ${i.e2eJobs} job e2e (${i.e2eSpecs} spec)`;

/** Đường dẫn/nhánh có phải của lát không. */
export const isSliceWorktree = (repoPath: string, branch: string): boolean =>
  /[\\/]evolu-wt[\\/]/i.test(repoPath) || branch.startsWith("slice/");

/** Tách `-Filter` theo bước: token có `/` là đường dẫn int, còn lại là tên job e2e (`-Step int|e2e` lấy hết cho bước đó). */
export function splitFilter(step: string, filter: string): { int: string[]; e2e: string[] } {
  const toks = filter.split(/[\s,]+/).filter(Boolean);
  if (step === "int") return { int: toks, e2e: [] };
  if (step === "e2e") return { int: [], e2e: toks };
  return { int: toks.filter((t) => t.includes("/")), e2e: toks.filter((t) => !t.includes("/")) };
}
