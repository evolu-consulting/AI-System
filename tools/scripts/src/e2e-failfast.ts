// tool-evotest-cache · fail-fast cho stack e2e (Luật 4c "không chờ hết giờ"). `test-e2e-par.ts` đặt BUN_OPTIONS="--preload <file này>" cho
// mọi việc ⇒ tiến trình `bun e2e/**/_*.ts` (stack dựng admin-api/hub-api… rồi chờ /health) mà có TIẾN TRÌNH CON thoát bất thường
// (mã ≠ 0, không do mình kill) thì CHÍNH stack in lý do và thoát ngay cùng mã đó ⇒ webServer của Playwright báo "Process … exited early"
// trong vài giây thay vì chờ timeout 240–300 s (hoặc để từng ca test treo tới hết giờ khi hub chết sau khi đã sẵn sàng).
// Không sửa file stack (đã khoá test); script khác (rsbuild, playwright, tool) không bị đụng.
export const isStackScript = (main: string): boolean =>
  /\/e2e\/(?:.+\/)?_[^/]+\.ts$/.test(main.replaceAll("\\", "/"));

/** Mô tả ngắn một lời gọi Bun.spawn để in lý do (lệnh, không in env). */
export function describeSpawn(args: unknown[]): string {
  const a = args[0];
  const cmd = Array.isArray(a) ? a : ((a as { cmd?: unknown[] } | undefined)?.cmd ?? []);
  return cmd
    .map(String)
    .map((s) => s.replaceAll("\\", "/").split("/").slice(-3).join("/"))
    .join(" ")
    .slice(0, 160);
}

type Exited = { exited: Promise<number>; signalCode?: string | null; pid?: number };

/** Gắn người canh vào tiến trình con; `die(code, msg)` mặc định in lỗi rồi `process.exit(code)`. */
export function watchChild(
  p: Exited,
  label: string,
  die: (code: number, msg: string) => void = (c, m) => {
    console.error(m);
    process.exit(c);
  },
): void {
  void p.exited.then((code) => {
    if (code !== 0 && (p.signalCode ?? null) === null)
      die(
        code || 1,
        `[failfast] tiến trình con thoát sớm (exit ${code}): ${label} - dừng stack để việc e2e báo lỗi ngay`,
      );
  });
}

if (isStackScript(Bun.main)) {
  const real = Bun.spawn;
  Bun.spawn = ((...args: unknown[]) => {
    const p = (real as (...a: unknown[]) => Exited)(...args);
    watchChild(p, describeSpawn(args));
    return p;
  }) as unknown as typeof Bun.spawn;
}
