// CR-121 T-1 Â· `verify:wave`: chia toÃ n bá»™ int + e2e ra cÃ¡c slot evotest theo THá»œI LÆ¯á»¢NG ÄÃƒ ÄO (khÃ´ng theo sá»‘ thÆ° má»¥c/file nhÆ° trÆ°á»›c).
// LPT: má»¥c náº·ng nháº¥t vÃ o thÃ¹ng sáº½ xong sá»›m nháº¥t; viá»‡c e2e > PIECE_CAP chia thÃ nh máº£nh (root theo file spec, viá»‡c khÃ¡c theo --shard).
// HÃ m thuáº§n; I/O (Ä‘á»c/ghi cache thá»i lÆ°á»£ng, gá»i evotest) á»Ÿ wave-timings.ts / verify-wave.ts.
import { rootToken, shardToken } from "./e2e-pieces.rules";
import type { Bin, ServerCmd } from "./test-affected.server.rules";
import { type SpecInfo, splitRoot } from "./test-e2e-par.rules";

/** Cache thá»i lÆ°á»£ng: int = giÃ¢y/file (1 worker, gá»“m beforeAll); e2e = `e2e/<spec>` (root) | `<viá»‡c>:<file>`; boot = giÃ¢y dá»±ng stack má»—i viá»‡c. */
export type WaveTimings = {
  int: Record<string, number>;
  e2e: Record<string, number>;
  boot: Record<string, number>;
};

export const emptyTimings = (): WaveTimings => ({ int: {}, e2e: {}, boot: {} });

/** Háº±ng sá»‘ mÃ´ hÃ¬nh (Ä‘o á»Ÿ lÆ°á»£t verify:wave 2026-11-05: setup+upload+dá»n â‰ˆ 35 s/lá»‡nh evotest; 2 viá»‡c e2e cÃ¹ng lÃºc trong slot). */
export const WAVE = {
  cmdOverheadS: 35,
  intWorkers: 1,
  intSpeedup: 1,
  e2eLanes: 2,
  /** Má»™t viá»‡c e2e (gá»“m dá»±ng stack) khÃ´ng quÃ¡ ~ngáº§n nÃ y giÃ¢y trong má»™t slot; lá»›n hÆ¡n â‡’ chia máº£nh. */
  pieceCapS: 150,
  /** Phần test tối thiểu mỗi mảnh: mảnh nhỏ hơn không đáng 1 lần dựng stack. */
  minPieceBodyS: 70,
  defaultIntS: 3.3,
  defaultBootS: 30,
  defaultSpecS: 15,
  defaultJobS: 90,
  rootMaxPieces: 7,
} as const;

export type E2ePiece = { token: string; job: string; cost: number };
export type IntItem = { file: string; cost: number };

export type WaveInput = {
  /** File int cá»§a cá»•ng ta (Ä‘Ã£ bá» Ä‘Ã³ng bÄƒng/cá»§a rowan). */
  intFiles: readonly string[];
  /** Má»ŒI file int (gá»“m Ä‘Ã³ng bÄƒng/rowan) - Ä‘á»ƒ chá»‰ thu gá»n thÃ nh thÆ° má»¥c khi cáº£ thÆ° má»¥c thuá»™c cá»•ng ta vÃ  cÃ¹ng má»™t thÃ¹ng. */
  allIntFiles: readonly string[];
  /** Viá»‡c e2e khÃ´ng pháº£i root: tÃªn viá»‡c + Ä‘Æ°á»ng dáº«n cáº¥u hÃ¬nh. */
  jobs: readonly { job: string; config: string }[];
  /** Spec gá»‘c (e2e/*.spec.ts); null = khÃ´ng cÃ³ viá»‡c root. */
  rootSpecs: readonly SpecInfo[] | null;
  timings: WaveTimings;
  slots: number;
};

export type WavePlan = {
  bins: Bin[];
  /** GiÃ¢y dá»± kiáº¿n má»—i thÃ¹ng (Ä‘Ã£ gá»“m chi phÃ­ lá»‡nh evotest). */
  estimates: number[];
  wall: number;
  pieces: string[];
};

const bootOf = (t: WaveTimings, job: string) => t.boot[job] ?? WAVE.defaultBootS;

/** Tá»•ng giÃ¢y viá»‡c khÃ´ng pháº£i root (stack + test): cÃ¡c khoÃ¡ `<viá»‡c>:<file>` + boot; chÆ°a Ä‘o â‡’ sá»‘ cÅ© theo cáº¥u hÃ¬nh, rá»“i máº·c Ä‘á»‹nh. */
export function jobSeconds(t: WaveTimings, job: string, config: string): number {
  const files = Object.entries(t.e2e)
    .filter(([k]) => k.startsWith(`${job}:`))
    .reduce((a, [, s]) => a + s, 0);
  if (files > 0) return files + bootOf(t, job);
  return t.e2e[config] ?? WAVE.defaultJobS;
}

/** Máº£nh e2e: viá»‡c â‰¤ cap má»™t máº£nh; lá»›n hÆ¡n chia Ä‘á»u báº±ng `--shard`; root chia theo file spec (LPT, spec ghim cá»•ng 3000 á»Ÿ máº£nh 0, Ä‘á»“ng há»“ giáº£ riÃªng). */
export function e2ePieces(i: Pick<WaveInput, "jobs" | "rootSpecs" | "timings">): E2ePiece[] {
  const { timings: t } = i;
  const out: E2ePiece[] = [];
  for (const { job, config } of i.jobs) {
    const total = jobSeconds(t, job, config);
    const boot = bootOf(t, job);
    // má»—i máº£nh tráº£ láº¡i chi phÃ­ dá»±ng stack â‡’ pháº§n test má»—i máº£nh â‰¤ cap âˆ’ boot
    const n =
      total <= WAVE.pieceCapS
        ? 1
        : Math.ceil((total - boot) / Math.max(WAVE.minPieceBodyS, WAVE.pieceCapS - boot));
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
      // job riÃªng má»—i máº£nh gá»‘c: má»—i máº£nh cÃ³ DB + cá»•ng riÃªng nÃªn Ä‘Æ°á»£c cháº¡y chung thÃ¹ng
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

/** GiÃ¢y cá»§a thÃ¹ng: lá»‡nh int (náº¿u cÃ³) rá»“i lá»‡nh e2e (náº¿u cÃ³), má»—i lá»‡nh +overhead; e2e = hai lÃ n cháº¡y cÃ¹ng lÃºc. */
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

/** Thu gá»n danh sÃ¡ch file thÃ nh tiá»n tá»‘ thÆ° má»¥c khi Má»ŒI file int dÆ°á»›i thÆ° má»¥c Ä‘Ã³ (ká»ƒ cáº£ Ä‘Ã³ng bÄƒng/rowan) Ä‘á»u thuá»™c thÃ¹ng nÃ y. */
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

/** GiÃ¢y cá»§a thÃ¹ng náº¿u nháº­n thÃªm `w` (khÃ´ng Ä‘á»•i thÃ¹ng). */
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

/** ThÃ¹ng sáº½ xong sá»›m nháº¥t sau khi nháº­n `w`; máº£nh cÃ¹ng cáº¥u hÃ¬nh khÃ´ng vÃ o thÃ¹ng Ä‘Ã£ cÃ³ máº£nh Ä‘Ã³ (Ä‘á»¥ng cá»•ng/dá»±ng). */
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

/** Báº£n in káº¿ hoáº¡ch: má»—i thÃ¹ng má»™t dÃ²ng (sá»‘ file int, máº£nh e2e, giÃ¢y dá»± kiáº¿n). */
export function renderPlan(p: WavePlan): string[] {
  return [
    `káº¿ hoáº¡ch: ${p.bins.length} thÃ¹ng, dá»± kiáº¿n ${p.wall} s (${(p.wall / 60).toFixed(1)} phÃºt)`,
    ...p.bins.map((b, k) => {
      const int = b.cmds.find((c) => c.step === "int");
      const e2e = b.cmds.find((c) => c.step === "e2e");
      return `  thÃ¹ng ${k + 1}: ~${p.estimates[k]} s Â· int ${int ? int.filter.split(" ").length : 0} má»¥c Â· e2e ${
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
