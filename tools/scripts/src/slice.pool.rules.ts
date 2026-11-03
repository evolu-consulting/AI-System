// slice:pool · luật thuần chọn/bổ sung worktree trong hồ bơi ấm (`<evolu-wt>/_pool/<n>`). I/O ở `slice.pool.ts`.

export const POOL_DEFAULT_SIZE = 3;
export const POOL_MAX_SIZE = 8;
/** Đĩa trống tối thiểu (GB) để dựng thêm worktree ấm (mỗi cái ~0,6 GB + node_modules); dưới ngưỡng ⇒ không dựng. */
export const POOL_MIN_DISK_GB = 30;

/** `--size N` hoặc `--size=N` (1..8); không có ⇒ mặc định 3; sai ⇒ lỗi (chuỗi mô tả). */
export function parsePoolSize(args: readonly string[]): { size: number } | { error: string } {
  let raw: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === "--size") raw = args[i + 1] ?? "";
    else if (a.startsWith("--size=")) raw = a.slice("--size=".length);
  }
  if (raw === undefined) return { size: POOL_DEFAULT_SIZE };
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n < 1 || n > POOL_MAX_SIZE)
    return { error: `--size phải là số nguyên 1..${POOL_MAX_SIZE} (nhận "${raw}")` };
  return { size: n };
}

const numeric = (a: string, b: string) => Number(a) - Number(b);

/** Worktree sẵn sàng để lấy: tên số, đã đăng ký trong git, đã có dấu `.ready` (bun install xong) — nhỏ nhất trước. */
export function pickReady(
  names: readonly string[],
  ready: ReadonlySet<string>,
  registered: ReadonlySet<string>,
): string | undefined {
  return names.filter((n) => /^\d+$/.test(n) && ready.has(n) && registered.has(n)).sort(numeric)[0];
}

/** Tên số còn thiếu để đủ `size` (đã tính cả mục đang có, sẵn sàng hay chưa): các số nguyên dương nhỏ nhất chưa dùng. */
export function missingNames(size: number, present: readonly string[]): string[] {
  const used = new Set(present.filter((n) => /^\d+$/.test(n)));
  const out: string[] = [];
  for (let i = 1; used.size + out.length < size; i++) if (!used.has(String(i))) out.push(String(i));
  return out;
}

/** Cổng đĩa: không đo được (undefined) ⇒ không dựng (an toàn). */
export function canBuild(
  freeDiskGb: number | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (freeDiskGb === undefined) return { ok: false, reason: "không đo được đĩa" };
  if (freeDiskGb < POOL_MIN_DISK_GB)
    return {
      ok: false,
      reason: `đĩa trống ${freeDiskGb.toFixed(1)} GB < ${POOL_MIN_DISK_GB} GB`,
    };
  return { ok: true };
}
