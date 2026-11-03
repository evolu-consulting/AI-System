// res-check · luật thuần: số đo tài nguyên → khuyến nghị song song + cảnh báo + giới hạn cứng.
// I/O (PowerShell, ssh) ở `res-check.ts`; bộ phân tích đầu ra ở `res-check.parse.ts`.

export type HeavyCounts = {
  postgres: number;
  playwright: number;
  chromium: number;
  bunTest: number;
  nodeDev: number;
};

export type LocalMetrics = {
  cores: number;
  /** Số lõi đang bận (Windows: cores × CPU%; nơi khác: loadavg 1 phút). */
  load: number;
  freeRamMb: number;
  totalRamMb: number;
  freeDiskGb: number;
  heavy: HeavyCounts;
  worktrees: { total: number; stale: number; orphans: number };
  lanes: number;
};

export type ServerMetrics = {
  cores: number;
  load1: number;
  freeRamMb: number;
  totalRamMb: number;
  freeDiskGb: number;
  containers: number;
  /** Mỗi phần tử: slot evotest đang bận (khoá `.lock` tồn tại). */
  slotsBusy: boolean[];
  /** CR-115: có lượt `run-tests.ps1 -Exclusive` (perf) đang giữ máy; vắng = chưa kiểm. */
  exclusive?: boolean;
};

export type Thresholds = {
  diskWarnGb: number;
  diskHardGb: number;
  ramWarnMb: number;
  ramHardMb: number;
  staleWorktrees: number;
  /** RAM dành cho hệ điều hành + phiên chính khi chia cho agent. */
  ramReserveMb: number;
  /** RAM ước tính mỗi agent chỉ-code (claude + bun typecheck/unit). */
  ramPerAgentMb: number;
  maxAgents: number;
  maxPlaywright: number;
};

export const DEFAULTS: Thresholds = {
  diskWarnGb: 30,
  diskHardGb: 15,
  ramWarnMb: 4096,
  ramHardMb: 2048,
  staleWorktrees: 3,
  ramReserveMb: 2048,
  ramPerAgentMb: 1024,
  maxAgents: 8,
  maxPlaywright: 2,
};

export type Recommendation = {
  /** Agent chỉ-code (sửa file + unit/typecheck) có thể chạy cùng lúc. */
  maxAgents: number;
  /** Lượt Playwright local còn có thể bật thêm (0..2), đã trừ lượt đang chạy. */
  maxPlaywright: number;
  /** Slot evotest trống để chạy int/e2e nặng (null = chưa kiểm máy chủ). */
  serverSlots: number | null;
  warnings: string[];
  /** Giới hạn cứng bị chạm (`--strict` thoát 2; `slice:new` từ chối). */
  hard: string[];
};

const gb = (mb: number) => (mb / 1024).toFixed(1);
const MB_PER_GB = 1024;

export function procClass(p: { name: string; cmd: string }): keyof HeavyCounts | undefined {
  const n = p.name.toLowerCase().replace(/\.exe$/, "");
  const c = p.cmd;
  if (n === "postgres") return /--fork/.test(c) ? undefined : "postgres";
  if (/^(chrome|chromium|msedge|headless_shell|chrome-headless-shell)$/.test(n))
    return /--type=/.test(c) || !/(--headless|ms-playwright|playwright)/i.test(c)
      ? undefined
      : "chromium";
  if (n !== "node" && n !== "bun") return undefined;
  if (/playwright[\\/].*cli\.js.*\btest\b|playwright test|run-playwright|test-e2e-par/i.test(c))
    return "playwright";
  if (/(^|[\s"\\/])test(:[\w-]+)*(\s|"|$)|test-affected|test-int-par|test-all/i.test(c))
    return n === "bun" ? "bunTest" : undefined;
  if (/rsbuild.*\bdev\b|\bvite\b|--watch|--hot|dev-server|bun(\.exe)?"?\s+(run\s+)?dev\b/i.test(c))
    return "nodeDev";
  return undefined;
}

/** Đếm tiến trình nặng từ bảng tiến trình (mỗi tiến trình vào đúng một nhóm). */
export function countHeavy(procs: { name: string; cmd: string }[]): HeavyCounts {
  const h: HeavyCounts = { postgres: 0, playwright: 0, chromium: 0, bunTest: 0, nodeDev: 0 };
  for (const p of procs) {
    const k = procClass(p);
    if (k) h[k]++;
  }
  return h;
}

const floorPos = (n: number) => Math.max(0, Math.floor(n));

export function recommendAgents(l: LocalMetrics, t: Thresholds): number {
  const byRam = floorPos((l.freeRamMb - t.ramReserveMb) / t.ramPerAgentMb);
  const byCpu = floorPos(l.cores - l.load);
  let n = Math.min(byRam, byCpu, t.maxAgents);
  if (l.freeRamMb >= t.ramHardMb) n = Math.max(n, 1);
  if (l.freeDiskGb < t.diskHardGb) n = Math.min(n, 1);
  else if (l.freeDiskGb < t.diskWarnGb) n = Math.min(n, 3);
  return n;
}

export function recommendPlaywright(l: LocalMetrics, t: Thresholds): number {
  const idle = l.cores - l.load;
  let cap = 0;
  if (l.freeRamMb >= 6144 && idle >= 4) cap = 2;
  else if (l.freeRamMb >= t.ramWarnMb && idle >= 2) cap = 1;
  if (l.freeDiskGb < t.diskHardGb) cap = 0;
  return Math.max(0, Math.min(cap, t.maxPlaywright) - l.heavy.playwright);
}

export function recommendServerSlots(s: ServerMetrics | undefined): number | null {
  if (!s) return null;
  if (s.exclusive) return 0; // lượt perf độc quyền: mọi lượt mới xếp hàng tới khi xong
  const free = s.slotsBusy.filter((b) => !b).length;
  if (s.load1 > s.cores || s.freeRamMb < 2048 || s.freeDiskGb < 10) return Math.min(free, 1);
  return free;
}

function localWarnings(l: LocalMetrics, t: Thresholds): string[] {
  const w: string[] = [];
  if (l.freeDiskGb < t.diskWarnGb)
    w.push(`đĩa trống ${l.freeDiskGb.toFixed(1)} GB < ${t.diskWarnGb} GB — dọn worktree đã merge`);
  if (l.freeRamMb < t.ramWarnMb)
    w.push(
      `RAM trống ${gb(l.freeRamMb)} GB < ${t.ramWarnMb / MB_PER_GB} GB — không chạy Playwright/int local`,
    );
  if (l.load >= l.cores * 0.9)
    w.push(`tải CPU ${l.load.toFixed(1)}/${l.cores} lõi — máy đang bận, giảm song song`);
  if (l.worktrees.stale + l.worktrees.orphans > t.staleWorktrees)
    w.push(
      `${l.worktrees.stale} worktree đã merge + ${l.worktrees.orphans} thư mục mồ côi (~0,6 GB/cái) — bun run slice:rm <tên>`,
    );
  if (l.heavy.postgres === 0)
    w.push(
      "Postgres local không chạy (int/e2e local sẽ lỗi; dùng evotest hoặc scripts/dev-db.ps1 -Wait)",
    );
  if (l.heavy.playwright > 2)
    w.push(`${l.heavy.playwright} lượt Playwright đang chạy cùng lúc (> 2)`);
  return w;
}

function serverWarnings(s: ServerMetrics, t: Thresholds): string[] {
  const w: string[] = [];
  const free = s.slotsBusy.filter((b) => !b).length;
  if (s.exclusive)
    w.push(
      "evotest: đang có lượt perf -Exclusive giữ cả máy — lượt mới xếp hàng tới khi đo xong (không chạy thêm)",
    );
  if (s.slotsBusy.length > 0 && free === 0)
    w.push(
      `evotest: cả ${s.slotsBusy.length} slot đều bận — lượt mới sẽ xếp hàng (tối đa 90 phút)`,
    );
  if (s.load1 > s.cores) w.push(`máy chủ quá tải: load ${s.load1.toFixed(1)} > ${s.cores} lõi`);
  if (s.freeRamMb < t.ramHardMb) w.push(`máy chủ RAM trống ${gb(s.freeRamMb)} GB`);
  if (s.freeDiskGb < t.diskHardGb) w.push(`máy chủ đĩa trống ${s.freeDiskGb.toFixed(1)} GB`);
  return w;
}

export function recommend(
  local: LocalMetrics,
  server?: ServerMetrics,
  t: Thresholds = DEFAULTS,
): Recommendation {
  const warnings = localWarnings(local, t);
  if (server) warnings.push(...serverWarnings(server, t));
  return {
    maxAgents: recommendAgents(local, t),
    maxPlaywright: recommendPlaywright(local, t),
    serverSlots: recommendServerSlots(server),
    warnings,
    hard: hardLimits(local, t),
  };
}

/** Giới hạn cứng chỉ xét máy local (nơi `slice:new` tạo worktree). */
export function hardLimits(l: LocalMetrics, t: Thresholds = DEFAULTS): string[] {
  const h: string[] = [];
  if (l.freeDiskGb < t.diskHardGb)
    h.push(`đĩa trống ${l.freeDiskGb.toFixed(1)} GB < ${t.diskHardGb} GB`);
  if (l.freeRamMb < t.ramHardMb)
    h.push(`RAM trống ${gb(l.freeRamMb)} GB < ${t.ramHardMb / MB_PER_GB} GB`);
  return h;
}

/** Bảng ngắn + khuyến nghị (văn bản thuần, một dòng một mục). */
export function formatReport(
  local: LocalMetrics,
  server: ServerMetrics | undefined,
  r: Recommendation,
  serverError?: string,
): string[] {
  const hv = local.heavy;
  const rows: [string, string][] = [
    [
      "LOCAL CPU",
      `${local.cores} lõi, tải ${local.load.toFixed(1)} (${Math.round((local.load / local.cores) * 100)}%)`,
    ],
    ["LOCAL RAM", `${gb(local.freeRamMb)} GB trống / ${gb(local.totalRamMb)} GB`],
    ["LOCAL đĩa", `${local.freeDiskGb.toFixed(1)} GB trống`],
    [
      "LOCAL nặng",
      `postgres ${hv.postgres}, playwright ${hv.playwright}, chromium ${hv.chromium}, bun test ${hv.bunTest}, dev server ${hv.nodeDev}`,
    ],
    [
      "LOCAL worktree",
      `${local.worktrees.total} (đã merge ${local.worktrees.stale}, mồ côi ${local.worktrees.orphans}), làn e2e ${local.lanes}`,
    ],
  ];
  if (server) {
    const busy = server.slotsBusy.map((b, i) => (b ? `s${i + 1}` : "")).filter(Boolean);
    rows.push(
      ["SERVER CPU", `${server.cores} lõi, load ${server.load1.toFixed(1)}`],
      ["SERVER RAM", `${gb(server.freeRamMb)} GB trống / ${gb(server.totalRamMb)} GB`],
      ["SERVER đĩa", `${server.freeDiskGb.toFixed(1)} GB trống, ${server.containers} container`],
      [
        "SERVER slot",
        `bận ${busy.length}/${server.slotsBusy.length}${busy.length ? ` (${busy.join(",")})` : ""}${server.exclusive ? " · PERF -Exclusive đang giữ máy" : ""}`,
      ],
    );
  } else if (serverError) rows.push(["SERVER", `không kiểm được: ${serverError}`]);
  const out = rows.map(([k, v]) => `  ${k.padEnd(15)} ${v}`);
  out.push(
    "KHUYẾN NGHỊ",
    `  agent chỉ-code song song tối đa : ${r.maxAgents}`,
    `  Playwright local còn bật được   : ${r.maxPlaywright} (tối đa 2)`,
    `  slot evotest trống (int/e2e)    : ${r.serverSlots === null ? "? (thêm --server)" : r.serverSlots}`,
  );
  for (const w of r.warnings) out.push(`  CẢNH BÁO: ${w}`);
  for (const h of r.hard) out.push(`  GIỚI HẠN CỨNG: ${h}`);
  return out;
}
