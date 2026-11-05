// CR-121 T-1 · `verify:wave`: chia toàn bộ int + e2e ra các slot evotest theo THỜI LƯỢNG ĐÃ ĐO (không theo số thư mục/file như trước).
// LPT: mục nặng nhất vào thùng sẽ xong sớm nhất; việc e2e > PIECE_CAP chia thành mảnh (root theo file spec, việc khác theo --shard).
// Hàm thuần; I/O (đọc/ghi cache thời lượng, gọi evotest) ở wave-timings.ts / verify-wave.ts.
import { rootToken, shardToken } from "./e2e-pieces.rules";
import type { Bin, ServerCmd } from "./test-affected.server.rules";
import { type SpecInfo, splitRoot } from "./test-e2e-par.rules";

/** Cache thời lượng: int = giây/file (1 worker, gồm beforeAll); e2e = `e2e/<spec>` (root) | `<việc>:<file>`; boot = giây dựng stack mỗi việc. */
export type WaveTimings = {
  int: Record<string, number>;
  e2e: Record<string, number>;
  boot: Record<string, number>;
};

export const emptyTimings = (): WaveTimings => ({ int: {}, e2e: {}, boot: {} });

/** Hằng số mô hình (đo ở lượt verify:wave 2026-11-05: setup+upload+dọn ≈ 35 s/lệnh evotest; 2 việc e2e cùng lúc trong slot). */
export const WAVE = {
  cmdOverheadS: 35,
  intWorkers: 2,
  intSpeedup: 1.6,
  e2eLanes: 2,
  /** Một việc e2e (gồm dựng stack) không quá ~ngần này giây trong một slot; lớn hơn ⇒ chia mảnh. */
  pieceCapS: 150,
  defaultIntS: 3.3,
  defaultBootS: 30,
  defaultSpecS: 15,
  defaultJobS: 90,
  rootMaxPieces: 7,
} as const;

export type E2ePiece = { token: string; job: string; cost: number };
export type IntItem = { file: string; cost: number };

export type WaveInput = {
  /** File int của cổng ta (đã bỏ đóng băng/của rowan). */
  intFiles: readonly string[];
  /** MỌI file int (gồm đóng băng/rowan) - để chỉ thu gọn thành thư mục khi cả thư mục thuộc cổng ta và cùng một thùng. */
  allIntFiles: readonly string[];
  /** Việc e2e không phải root: tên việc + đường dẫn cấu hình. */
  jobs: readonly { job: string; config: string }[];
  /** Spec gốc (e2e/*.spec.ts); null = không có việc root. */
  rootSpecs: readonly SpecInfo[] | null;
  timings: WaveTimings;
  slots: number;
};

export type WavePlan = {
  bins: Bin[];
  /** Giây dự kiến mỗi thùng (đã gồm chi phí lệnh evotest). */
  estimates: number[];
  wall: number;
  pieces: string[];
};

const bootOf = (t: WaveTimings, job: string) => t.boot[job] ?? WAVE.defaultBootS;

/** Tổng giây việc không phải root (stack + test): các khoá `<việc>:<file>` + boot; chưa đo ⇒ số cũ theo cấu hình, rồi mặc định. */
export function jobSeconds(t: WaveTimings, job: string, config: string): number {
  const files = Object.entries(t.e2e)
    .filter(([k]) => k.startsWith(`${job}:`))
    .reduce((a, [, s]) => a + s, 0);
  if (files > 0) return files + bootOf(t, job);
  return t.e2e[config] ?? WAVE.defaultJobS;
}

/** Mảnh e2e: việc ≤ cap một mảnh; lớn hơn chia đều bằng `--shard`; root chia theo file spec (LPT, spec ghim cổng 3000 ở mảnh 0, đồng hồ giả riêng). */
export function e2ePieces(i: Pick<WaveInput, "jobs" | "rootSpecs" | "timings">): E2ePiece[] {
  const { timings: t } = i;
  const out: E2ePiece[] = [];
  for (const { job, config } of i.jobs) {
    const total = jobSeconds(t, job, config);
    const boot = bootOf(t, job);
    // mỗi mảnh trả lại chi phí dựng stack ⇒ phần test mỗi mảnh ≤ cap − boot
    const n =
      total <= WAVE.pieceCapS ? 1 : Math.ceil((total - boot) / Math.max(30, WAVE.pieceCapS - boot));
    if (n === 1) out.push({ token: job, job, cost: total });
    else {
      for (let k = 1; k <= n; k++)
        out.push({ token: shardToken(job, k, n), job, cost: boot + (total - boot) / n });
    }
  }
  if (i.rootSpecs?.length) {
    const specs = i.rootSpecs.map((s) => ({ ...s, cost: t.e2e[s.file] ?? WAVE.defaultSpecS }));
    const boot = bootOf(t, "root");
    const body = specs.filter((s) => !s.clock).reduce((a, s) => a + s.cost, 0);
    const n = Math.max(1, Math.min(WAVE.rootMaxPieces, Math.ceil((body + boot) / WAVE.pieceCapS)));
    let idx = 0;
    for (const files of splitRoot(specs, n)) {
      const clock = files.some((f) => f.clock);
      const cost = boot + files.reduce((a, f) => a + f.cost, 0);
      const key = clock ? "clock" : String(idx++);
      // job riêng mỗi mảnh gốc: mỗi mảnh có DB + cổng riêng nên được chạy chung thùng
      out.push({
        token: rootToken(
          key,
          files.map((f) => f.file),
        ),
        job: `root-${key}`,
        cost,
      });
    }
  }
  return out;
}

type BinState = {
  ints: string[];
  pieces: E2ePiece[];
  intS: number;
  lanes: number[];
  jobs: Set<string>;
};

/** Giây của thùng: lệnh int (nếu có) rồi lệnh e2e (nếu có), mỗi lệnh +overhead; e2e = hai làn chạy cùng lúc. */
export function binSeconds(b: Pick<BinState, "ints" | "pieces" | "intS" | "lanes">): number {
  const int = b.ints.length ? WAVE.cmdOverheadS + b.intS / WAVE.intSpeedup : 0;
  const e2e = b.pieces.length ? WAVE.cmdOverheadS + Math.max(...b.lanes) : 0;
  return int + e2e;
}

const newBin = (): BinState => ({
  ints: [],
  pieces: [],
  intS: 0,
  lanes: new Array<number>(WAVE.e2eLanes).fill(0),
  jobs: new Set(),
});

const lightest = (lanes: readonly number[]) => lanes.indexOf(Math.min(...lanes));

/** Thu gọn danh sách file thành tiền tố thư mục khi MỌI file int dưới thư mục đó (kể cả đóng băng/rowan) đều thuộc thùng này. */
export function collapseDirs(files: readonly string[], all: readonly string[]): string[] {
  const mine = new Set(files);
  const clean = new Map<string, boolean>();
  const isClean = (d: string) => {
    let c = clean.get(d);
    if (c === undefined) {
      c = all.filter((f) => f.startsWith(`${d}/`)).every((f) => mine.has(f));
      clean.set(d, c);
    }
    return c;
  };
  const out = new Set<string>();
  for (const f of files) {
    const parts = f.split("/").slice(0, -1);
    let hit = "";
    for (let k = 1; k <= parts.length && !hit; k++) {
      const d = parts.slice(0, k).join("/");
      if (isClean(d)) hit = `${d}/`;
    }
    out.add(hit || f);
  }
  return [...out].sort();
}

type Work = { eff: number; int?: IntItem; piece?: E2ePiece };

/** Giây của thùng nếu nhận thêm `w` (không đổi thùng). */
function secondsWith(b: BinState, w: Work): number {
  if (w.int) return binSeconds({ ...b, ints: [...b.ints, w.int.file], intS: b.intS + w.int.cost });
  const p = w.piece as E2ePiece;
  const at = lightest(b.lanes);
  return binSeconds({
    ...b,
    pieces: [...b.pieces, p],
    lanes: b.lanes.map((l, k) => (k === at ? l + p.cost : l)),
  });
}

/** Thùng sẽ xong sớm nhất sau khi nhận `w`; mảnh cùng cấu hình không vào thùng đã có mảnh đó (đụng cổng/dựng). */
function pickBin(bins: readonly BinState[], w: Work): BinState {
  const ok = bins.filter((b) => !(w.piece && b.jobs.has(w.piece.job)));
  return (ok.length ? ok : bins).reduce((m, b) => (secondsWith(b, w) < secondsWith(m, w) ? b : m));
}

function add(b: BinState, w: Work): void {
  if (w.int) {
    b.ints.push(w.int.file);
    b.intS += w.int.cost;
  } else if (w.piece) {
    const at = lightest(b.lanes);
    b.pieces.push(w.piece);
    b.lanes[at] = (b.lanes[at] ?? 0) + w.piece.cost;
    b.jobs.add(w.piece.job);
  }
}

export function planWave(i: WaveInput): WavePlan {
  const pieces = e2ePieces(i);
  const ints: IntItem[] = i.intFiles.map((file) => ({
    file,
    cost: Math.max(0.3, i.timings.int[file] ?? WAVE.defaultIntS),
  }));
  const all: Work[] = [
    ...pieces.map((piece): Work => ({ eff: piece.cost / WAVE.e2eLanes, piece })),
    ...ints.map((int): Work => ({ eff: int.cost / WAVE.intSpeedup, int })),
  ];
  const work = all.sort(
    (a, b) =>
      b.eff - a.eff ||
      (a.int?.file ?? a.piece?.token ?? "").localeCompare(b.int?.file ?? b.piece?.token ?? ""),
  );
  const bins = Array.from({ length: Math.max(1, i.slots) }, newBin);
  for (const w of work) add(pickBin(bins, w), w);
  const used = bins.filter((b) => b.ints.length || b.pieces.length);
  const out: Bin[] = used.map((b) => {
    const cmds: ServerCmd[] = [];
    if (b.ints.length)
      cmds.push({
        step: "int",
        filter: collapseDirs(b.ints, i.allIntFiles).join(" "),
        workers: WAVE.intWorkers,
      });
    if (b.pieces.length) cmds.push({ step: "e2e", filter: b.pieces.map((p) => p.token).join(",") });
    return { cmds, cost: Math.round(binSeconds(b)) };
  });
  const estimates = used.map((b) => Math.round(binSeconds(b)));
  return {
    bins: out,
    estimates,
    wall: Math.max(0, ...estimates),
    pieces: pieces.map((p) => p.token),
  };
}

/** Bản in kế hoạch: mỗi thùng một dòng (số file int, mảnh e2e, giây dự kiến). */
export function renderPlan(p: WavePlan): string[] {
  return [
    `kế hoạch: ${p.bins.length} thùng, dự kiến ${p.wall} s (${(p.wall / 60).toFixed(1)} phút)`,
    ...p.bins.map((b, k) => {
      const int = b.cmds.find((c) => c.step === "int");
      const e2e = b.cmds.find((c) => c.step === "e2e");
      return `  thùng ${k + 1}: ~${p.estimates[k]} s · int ${int ? int.filter.split(" ").length : 0} mục · e2e ${
        e2e
          ? e2e.filter
              .split(",")
              .map((t) => t.split("=")[0])
              .join(",")
          : "-"
      }`;
    }),
  ];
}
