// CR-092 · danh sách bước của `bun run test:all` (bộ hồi quy chạy lại được). Hàm thuần: nhận cấu hình e2e đã tìm
// thấy + cờ, trả các bước theo thứ tự; `test-all.ts` lo chạy lệnh.

export type Step = { name: string; cmd: string[] };
export type Opts = { e2e: boolean; python: boolean; only?: string };

/** Đường dẫn cấu hình Playwright (đã chuẩn hoá `/`), sắp xếp để thứ tự chạy ổn định. */
export function e2eSteps(configs: readonly string[]): Step[] {
  return [...configs]
    .map((c) => c.replaceAll("\\", "/"))
    .sort()
    .map((c) => ({ name: `e2e:${c}`, cmd: ["bunx", "playwright", "test", "-c", c] }));
}

export function buildSteps(configs: readonly string[], o: Opts): Step[] {
  const steps: Step[] = [
    { name: "check", cmd: ["bun", "run", "check"] },
    { name: "typecheck", cmd: ["bun", "run", "typecheck"] },
    { name: "unit", cmd: ["bun", "test"] },
    { name: "int", cmd: ["bun", "run", "test:int"] },
    { name: "lock", cmd: ["bun", "run", "test:lock:verify"] },
  ];
  if (o.python)
    steps.push({ name: "python", cmd: ["bun", "run", "--filter", "@ai/agent-runtime", "test"] });
  if (o.e2e) steps.push(...e2eSteps(configs));
  return o.only ? steps.filter((s) => s.name === o.only || s.name.startsWith(`${o.only}:`)) : steps;
}

/** `--no-e2e`, `--no-python`, `--only=<tên bước hoặc tiền tố>`. */
export function parseArgs(argv: readonly string[]): Opts {
  const only = argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);
  return { e2e: !argv.includes("--no-e2e"), python: !argv.includes("--no-python"), only };
}
