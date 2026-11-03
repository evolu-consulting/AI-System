// `test:affected --run server`: chia int + e2e của kế hoạch ra các "thùng" chạy song song trên các slot evotest còn trống
// (mỗi thùng = một chuỗi lệnh `run-tests.ps1` nối tiếp). Hàm thuần; `test-affected.server.ts` lo gọi ssh/pwsh.
import { META } from "./test-e2e-par.rules";

export type ServerCmd = { step: "int" | "e2e"; filter: string };
export type Bin = { cmds: ServerCmd[]; cost: number };

/** Ước lượng giây mỗi file int (đo trung bình P-a+K1: 51 s / ~170 file, chia thêm cho song song worker). */
const INT_FILE_COST = 3;
const INT_CHUNK_MIN = 6;

/** Giây ước lượng của một việc e2e (theo cấu hình); việc lạ = 60 s. `root` gom mọi ca gốc. */
export function e2eCost(job: string, configs: readonly string[]): number {
  const cs = configs.filter((c) =>
    job === "root" ? c === "playwright.config.ts" : c.includes(job),
  );
  return cs.reduce((a, c) => a + (META[c]?.cost ?? 60), 0) || 60;
}

/** Chia mảng thành `n` nhóm gần bằng nhau (xen kẽ, giữ thứ tự tương đối). */
export function chunkEven<T>(items: readonly T[], n: number): T[][] {
  const bins: T[][] = Array.from({ length: Math.max(1, Math.min(n, items.length)) }, () => []);
  for (const [i, x] of items.entries()) bins[i % bins.length]?.push(x);
  return bins.filter((b) => b.length);
}

type Item = { cmd: ServerCmd; cost: number };

/**
 * Chia công việc vào `free` thùng (≥ 1; không còn slot ⇒ 1 thùng, evotest tự xếp hàng). e2e: mỗi việc một mục (cost từ META);
 * int: tách thành tối đa `free` lô (mỗi lô ≥ INT_CHUNK_MIN file). LPT: mục nặng vào thùng nhẹ nhất; hai mục cùng thùng ⇒ nối tiếp.
 */
export function serverBins(
  int: readonly string[],
  jobs: readonly string[],
  configs: readonly string[],
  free: number,
): Bin[] {
  const n = Math.max(1, free);
  const maxChunks = Math.max(1, Math.min(n, Math.floor(int.length / INT_CHUNK_MIN) || 1));
  const items: Item[] = [
    ...(int.length ? chunkEven(int, maxChunks) : []).map((files) => ({
      cmd: { step: "int", filter: files.join(" ") } as ServerCmd,
      cost: files.length * INT_FILE_COST,
    })),
    ...jobs.map((j) => ({
      cmd: { step: "e2e", filter: j } as ServerCmd,
      cost: e2eCost(j, configs),
    })),
  ].sort((a, b) => b.cost - a.cost);
  const bins: Bin[] = Array.from({ length: Math.min(n, items.length) }, () => ({
    cmds: [],
    cost: 0,
  }));
  for (const it of items) {
    const b = bins.reduce((m, x) => (x.cost < m.cost ? x : m));
    b.cmds.push(it.cmd);
    b.cost += it.cost;
  }
  return bins.filter((b) => b.cmds.length).map((b) => ({ ...b, cmds: mergeCmds(b.cmds) }));
}

/** Một thùng chạy tối đa hai lệnh (một int, một e2e): mỗi lệnh evotest tốn một lần dựng/setup nên gộp cùng bước. */
export function mergeCmds(cmds: readonly ServerCmd[]): ServerCmd[] {
  const out: ServerCmd[] = [];
  for (const step of ["int", "e2e"] as const) {
    const fs = cmds.filter((c) => c.step === step).map((c) => c.filter);
    if (fs.length) out.push({ step, filter: fs.join(step === "int" ? " " : ",") });
  }
  return out;
}

/** Đối số `run-tests.ps1` cho một lệnh: `-Step int|e2e -Filter … [-Dirty]`. e2e gộp nhiều việc bằng dấu phẩy. */
export function evotestArgs(cmd: ServerCmd, dirty: boolean, all = false): string[] {
  return [
    "-NoProfile",
    "-File",
    "deploy/evotest/run-tests.ps1",
    "-Step",
    cmd.step,
    "-Filter",
    cmd.filter,
    ...(dirty ? ["-Dirty"] : []),
    ...(all ? ["-All"] : []),
  ];
}

/** Số slot trống từ JSON của `res:check --server --json` (không đo được ⇒ null). */
export function freeSlotsOf(json: unknown): number | null {
  const j = json as {
    recommendation?: { serverSlots?: number | null };
    server?: { slotsBusy?: boolean[] } | null;
  } | null;
  const rec = j?.recommendation?.serverSlots;
  if (typeof rec === "number") return rec;
  const busy = j?.server?.slotsBusy;
  return Array.isArray(busy) ? busy.filter((b) => !b).length : null;
}
