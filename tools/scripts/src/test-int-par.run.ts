// ADM-NFR-06 · chạy một lô file int trong MỘT tiến trình `bun test` + watchdog treo (tool-evotest-hang): đọc stdout/stderr theo luồng,
// không output quá `idleS` hoặc một file quá `fileS` ⇒ in "TREO: …", SIGKILL, trả `hung` + các file chưa chạy để worker chạy tiếp.
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { type HangCfg, type HangVerdict, HangWatch, hangLine } from "./test-int-par.watchdog";

export const DATA = ".data";
export const BASE_CMD = [
  "bun",
  "--env-file=.env.local",
  "--config=bunfig.int.toml",
  "test",
  "--timeout",
  "30000",
];

export type Run = {
  name: string;
  files: number;
  code: number;
  ms: number;
  text: string;
  junit: string;
  /** Có ⇒ lô bị watchdog kill; `rest` đã được `drain` đưa lại hàng đợi. */
  hung?: HangVerdict;
  /** Mili giây mỗi file (header→header, gồm beforeAll); JUnit cấp file luôn 0 nên không dùng được cho chia việc. */
  fileMs?: Record<string, number>;
};

export type ChunkOpts = {
  env: Record<string, string>;
  root: string;
  hang: HangCfg;
  /** Lệnh `bun test` (mặc định BASE_CMD); test tích hợp truyền lệnh nhẹ không cần DB. */
  cmd?: readonly string[];
  /** Chu kỳ kiểm tra watchdog (ms). */
  pollMs?: number;
  log?: (line: string) => void;
};

async function pump(s: ReadableStream<Uint8Array>, buf: string[], on: (t: string) => void) {
  const r = s.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { value, done } = await r.read();
    if (done) return;
    const t = dec.decode(value, { stream: true });
    buf.push(t);
    on(t);
  }
}

/** Một lô file trong một tiến trình `bun test`; log nối vào `.data/int-<ô>.log`. */
export async function runChunk(
  slot: string,
  k: number,
  files: string[],
  opts: ChunkOpts,
): Promise<Run> {
  const { env, root, hang, log = console.log } = opts;
  const name = `${slot}-${k}`;
  const junit = join(DATA, `int-junit-${name}.xml`);
  const t0 = performance.now();
  const p = Bun.spawn(
    [
      ...(opts.cmd ?? BASE_CMD),
      "--reporter=junit",
      `--reporter-outfile=${junit}`,
      ...files.map((f) => `./${f}`),
    ],
    { cwd: root, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" },
  );
  const wd = new HangWatch(files, hang, t0);
  const [out, err]: [string[], string[]] = [[], []];
  const pumps = Promise.all([
    pump(p.stdout, out, (t) => wd.feed(t, performance.now(), 0)),
    pump(p.stderr, err, (t) => wd.feed(t, performance.now(), 1)),
  ]);
  let hung: HangVerdict | undefined;
  const watching = hang.idleS > 0 || hang.fileS > 0;
  const timer = watching
    ? setInterval(() => {
        if (hung) return;
        hung = wd.check(performance.now()) ?? undefined;
        if (!hung) return;
        log(`  [${name}] ${hangLine(hung)} → kill`);
        p.kill("SIGKILL");
      }, opts.pollMs ?? 1000)
    : undefined;
  let code: number;
  try {
    code = await p.exited;
    // Sau kill, con cháu giữ pipe mở thì không chờ mãi: tối đa 3 s.
    await (hung ? Promise.race([pumps, Bun.sleep(3000)]) : pumps);
  } finally {
    if (timer) clearInterval(timer);
  }
  const fileMs = Object.fromEntries(wd.finish(performance.now()));
  const mark = hung ? `\n${hangLine(hung)}\n` : "";
  const text = out.join("") + err.join("") + mark;
  appendFileSync(join(root, DATA, `int-${slot}.log`), `\n=== ${name}: ${files.join(" ")}\n${text}`);
  if (hung && code === 0) code = 137;
  return { name, files: files.length, code, ms: performance.now() - t0, text, junit, hung, fileMs };
}

/** Lấy lô từ hàng đợi tới khi hết; lô bị kill ⇒ file chưa chạy quay lại ĐẦU hàng đợi (mỗi vòng ít nhất bỏ file treo ⇒ luôn dừng). */
export async function drain(
  slot: string,
  queue: string[],
  take: (q: string[]) => string[],
  opts: ChunkOpts,
): Promise<Run[]> {
  const runs: Run[] = [];
  for (let k = 0; queue.length; k++) {
    const r = await runChunk(slot, k, take(queue), opts);
    runs.push(r);
    if (r.hung?.rest.length) queue.unshift(...r.hung.rest);
  }
  return runs;
}
