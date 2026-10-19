// CR-092 · danh sách bước của `bun run test:all` (bộ hồi quy chạy lại được). Hàm thuần: nhận cấu hình e2e đã tìm
// thấy + cờ, trả các bước theo thứ tự; `test-all.ts` lo chạy lệnh.
// TS1: mỗi bước có `wave`; các bước CÙNG đợt chạy song song (log vào .data/test-all/), đợt sau chờ đợt trước xong.
// Gom đợt: `waves` ở lib/run-steps.ts.
// e2e: MỘT bước `e2e` (test-e2e-par: mọi cấu hình, DB/cổng riêng) thay cho 18 bước nối tiếp.

/** `blocked` = thiếu công cụ trên máy này (không tải về): bước không chạy, ghi rõ lý do, không tính là đỏ (GX). */
export type Step = { name: string; cmd: string[]; blocked?: string; wave: number };
/** `pyBlocked`: lý do không chạy được bước Python/typecheck agent-runtime (vd thiếu docker); `envLocal`: có `.env.local`. */
export type Opts = {
  e2e: boolean;
  python: boolean;
  only?: string;
  pyBlocked?: string;
  envLocal?: boolean;
  /** `--serial`: mỗi bước một đợt, nối tiếp (chẩn đoán chập chờn do tải). */
  serial?: boolean;
  /** F1 (CR-095) · `--no-frozen`: cổng hằng ngày — bỏ suite module đóng băng (unit/int/e2e). Vắng ⇒ chạy hết (kiểm tra hằng tháng). */
  noFrozen?: boolean;
};

/** bunfig sinh cho unit khi `--no-frozen` (gốc + mẫu đóng băng); `test-all.ts` ghi file này trước khi chạy. */
export const GATE_BUNFIG = ".data/test-gate/bunfig.toml";

/** Đợt của bước nhẹ (kiểm tĩnh + unit) và nặng (int + e2e + python). */
const WAVE_LIGHT = 1;
// TS1 (đo): int ∥ e2e làm int 438 → 916 s và vỡ ca có ngân sách thời gian (M2-R27 < 900 ms, NOTIFY…) ⇒ int và e2e KHÔNG chạy cùng nhau:
// đợt 1 nhẹ (song song), đợt 2 int, đợt 3 e2e (python cùng đợt int; bị chặn nếu thiếu docker).
const WAVE_INT = 2;
const WAVE_E2E = 3;

/** Bước e2e: `--only=e2e:<việc>` truyền `--only=<việc>` cho test-e2e-par; không chọn ⇒ chạy hết. */
export function e2eStep(filter?: string, noFrozen = false): Step {
  const cmd = ["bun", "tools/scripts/src/test-e2e-par.ts", ...(noFrozen ? ["--no-frozen"] : [])];
  return { name: "e2e", cmd: filter ? [...cmd, `--only=${filter}`] : cmd, wave: WAVE_E2E };
}

export function buildSteps(o: Opts): Step[] {
  // `bun test` không nạp `.env.local` (NODE_ENV=test) ⇒ ca cần `HUB_TEST_DATABASE_URL` đỏ oan; nạp tường minh (GX).
  const gate = o.noFrozen ? [`--config=${GATE_BUNFIG}`] : [];
  const unit = o.envLocal
    ? ["bun", "--env-file=.env.local", ...gate, "test"]
    : ["bun", ...gate, "test"];
  // #230: `typecheck` của agent-runtime chạy qua docker; thiếu docker ⇒ chỉ phần còn lại + bước bị chặn riêng.
  const typecheck: Step[] = o.pyBlocked
    ? [
        { name: "typecheck", cmd: ["bun", "run", "typecheck:host"], wave: WAVE_LIGHT },
        { name: "typecheck:agent-runtime", cmd: [], blocked: o.pyBlocked, wave: WAVE_LIGHT },
      ]
    : [{ name: "typecheck", cmd: ["bun", "run", "typecheck"], wave: WAVE_LIGHT }];
  const steps: Step[] = [
    { name: "check", cmd: ["bun", "run", "check"], wave: WAVE_LIGHT },
    ...typecheck,
    { name: "unit", cmd: unit, wave: WAVE_LIGHT },
    {
      name: "int",
      cmd: ["bun", "run", "test:int:par", ...(o.noFrozen ? ["--no-frozen"] : [])],
      wave: WAVE_INT,
    },
    { name: "lock", cmd: ["bun", "run", "test:lock:verify"], wave: WAVE_LIGHT },
  ];
  if (o.python) {
    const cmd = ["bun", "run", "--filter", "@ai/agent-runtime", "test"];
    steps.push(
      o.pyBlocked
        ? { name: "python", cmd, blocked: o.pyBlocked, wave: WAVE_INT }
        : { name: "python", cmd, wave: WAVE_INT },
    );
  }
  const only = o.only;
  const e2eFilter = only?.startsWith("e2e:") ? only.slice("e2e:".length) : undefined;
  if (o.e2e) steps.push(e2eStep(e2eFilter, o.noFrozen));
  const chosen = only
    ? steps.filter(
        (s) =>
          s.name === only ||
          s.name.startsWith(`${only}:`) ||
          (e2eFilter !== undefined && s.name === "e2e"),
      )
    : steps;
  return o.serial ? chosen.map((s, i) => ({ ...s, wave: i })) : chosen;
}

/** `--no-e2e`, `--no-python`, `--no-frozen`, `--serial`, `--only=<tên bước hoặc tiền tố>` (vd `e2e:P-a`). */
export function parseArgs(argv: readonly string[]): Opts {
  const only = argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);
  return {
    e2e: !argv.includes("--no-e2e"),
    python: !argv.includes("--no-python"),
    only,
    serial: argv.includes("--serial"),
    noFrozen: argv.includes("--no-frozen"),
  };
}
