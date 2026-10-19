// CR-092 · danh sách bước của `bun run test:all` (bộ hồi quy chạy lại được). Hàm thuần: nhận cấu hình e2e đã tìm
// thấy + cờ, trả các bước theo thứ tự; `test-all.ts` lo chạy lệnh.

/** `blocked` = thiếu công cụ trên máy này (không tải về): bước không chạy, ghi rõ lý do, không tính là đỏ (GX). */
export type Step = { name: string; cmd: string[]; blocked?: string };
/** `pyBlocked`: lý do không chạy được bước Python/typecheck agent-runtime (vd thiếu docker); `envLocal`: có `.env.local`. */
export type Opts = {
  e2e: boolean;
  python: boolean;
  only?: string;
  pyBlocked?: string;
  envLocal?: boolean;
};

/** Đường dẫn cấu hình Playwright (đã chuẩn hoá `/`), sắp xếp để thứ tự chạy ổn định. */
export function e2eSteps(configs: readonly string[]): Step[] {
  return [...configs]
    .map((c) => c.replaceAll("\\", "/"))
    .sort()
    .map((c) => ({ name: `e2e:${c}`, cmd: ["bun", "tools/scripts/src/run-playwright.ts", c] }));
}

export function buildSteps(configs: readonly string[], o: Opts): Step[] {
  // `bun test` không nạp `.env.local` (NODE_ENV=test) ⇒ ca cần `HUB_TEST_DATABASE_URL` đỏ oan; nạp tường minh (GX).
  const unit = o.envLocal ? ["bun", "--env-file=.env.local", "test"] : ["bun", "test"];
  // #230: `typecheck` của agent-runtime chạy qua docker; thiếu docker ⇒ chỉ phần còn lại + bước bị chặn riêng.
  const typecheck: Step[] = o.pyBlocked
    ? [
        { name: "typecheck", cmd: ["bun", "run", "typecheck:host"] },
        { name: "typecheck:agent-runtime", cmd: [], blocked: o.pyBlocked },
      ]
    : [{ name: "typecheck", cmd: ["bun", "run", "typecheck"] }];
  const steps: Step[] = [
    { name: "check", cmd: ["bun", "run", "check"] },
    ...typecheck,
    { name: "unit", cmd: unit },
    { name: "int", cmd: ["bun", "run", "test:int:par"] },
    { name: "lock", cmd: ["bun", "run", "test:lock:verify"] },
  ];
  if (o.python) {
    const cmd = ["bun", "run", "--filter", "@ai/agent-runtime", "test"];
    steps.push(
      o.pyBlocked ? { name: "python", cmd, blocked: o.pyBlocked } : { name: "python", cmd },
    );
  }
  if (o.e2e) steps.push(...e2eSteps(configs));
  return o.only ? steps.filter((s) => s.name === o.only || s.name.startsWith(`${o.only}:`)) : steps;
}

/** `--no-e2e`, `--no-python`, `--only=<tên bước hoặc tiền tố>`. */
export function parseArgs(argv: readonly string[]): Opts {
  const only = argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);
  return { e2e: !argv.includes("--no-e2e"), python: !argv.includes("--no-python"), only };
}
