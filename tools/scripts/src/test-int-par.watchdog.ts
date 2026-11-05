// tool-evotest-hang · watchdog của `test:int:par`: bun 1.3.14 đôi khi KHÔNG thoát sau khi một test vượt timeout 30 s (quay 100% CPU,
// không còn kết nối DB) ⇒ cả lượt treo. Hàm/ lớp thuần, đồng hồ truyền vào (test dùng đồng hồ giả, không sleep thật);
// `test-int-par.run.ts` lo spawn + kill. Chỉ ĐỌC luồng stdout/stderr đã có, không thêm việc cho lượt bình thường.
import { norm } from "./test-int-par.rules";

/** Giây. 0 = tắt điều kiện đó. */
export type HangCfg = { idleS: number; fileS: number };
export const DEFAULT_HANG: HangCfg = { idleS: 120, fileS: 300 };

const num = (v: string | undefined, d: number) => {
  if (v === undefined || v === "") return d;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`watchdog: giá trị giây không hợp lệ: ${v}`);
  return n;
};

/** `--hang-idle=<s>` / `--hang-file=<s>` hoặc env `INT_HANG_IDLE_S` / `INT_HANG_FILE_S` (cờ thắng env; 0 = tắt). */
export function parseHangCfg(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>> = {},
): HangCfg {
  const flag = (n: string) => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  return {
    idleS: num(flag("hang-idle") ?? env.INT_HANG_IDLE_S, DEFAULT_HANG.idleS),
    fileS: num(flag("hang-file") ?? env.INT_HANG_FILE_S, DEFAULT_HANG.fileS),
  };
}

export type HangVerdict = {
  reason: "idle" | "file";
  /** File bị coi là treo (header `file:` cuối cùng thấy được; chưa thấy header ⇒ file đầu của lô). */
  file: string;
  /** Tên test cuối cùng thấy được (dòng `(pass)`/`(fail)`), rỗng nếu chưa có. */
  lastTest: string;
  /** File sau file treo trong lô (chưa chạy): chạy lại ở lô kế. */
  rest: string[];
  /** Số giây đã im (idle) hoặc đã chạy file (file). */
  seconds: number;
};

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const HEADER = /^(\S.*\.(?:test|spec)\.[cm]?[jt]sx?):\s*$/;
const RESULT = /^\((?:pass|fail|skip|todo)\) (.*?)(?: \[[\d.]+ ?(?:ms|s|µs)\])?\s*$/;

export function hangLine(v: HangVerdict): string {
  const why =
    v.reason === "idle" ? `im ${Math.round(v.seconds)} s` : `file quá ${Math.round(v.seconds)} s`;
  return `TREO: ${v.file} · test cuối: ${v.lastTest || "(chưa có)"} · ${why}`;
}

export class HangWatch {
  private cur: string | null = null;
  private fileStart: number;
  private lastOut: number;
  private lastTest = "";
  private readonly buf: [string, string] = ["", ""];
  private readonly files: string[];

  constructor(
    files: readonly string[],
    private readonly cfg: HangCfg,
    now: number,
  ) {
    this.files = files.map(norm);
    this.fileStart = now;
    this.lastOut = now;
  }

  /** Nhận một mảnh văn bản của luồng `stream` (0 = stdout, 1 = stderr); tách dòng theo từng luồng. */
  feed(text: string, now: number, stream: 0 | 1 = 0): void {
    if (!text) return;
    this.lastOut = now;
    const parts = (this.buf[stream] + text).split(/\r?\n/);
    this.buf[stream] = parts.pop() ?? "";
    for (const raw of parts) this.line(raw.replace(ANSI, ""), now);
  }

  private line(l: string, now: number): void {
    const h = HEADER.exec(l)?.[1];
    if (h) {
      const p = norm(h);
      this.cur = this.files.find((f) => f === p || f.endsWith(`/${p}`) || p.endsWith(`/${f}`)) ?? p;
      this.fileStart = now;
      this.lastTest = "";
      return;
    }
    const r = RESULT.exec(l)?.[1];
    if (r) this.lastTest = r;
  }

  /** Trả phán quyết nếu lô đang treo (im quá `idleS` hoặc file hiện tại chạy quá `fileS`); ngược lại null. */
  check(now: number): HangVerdict | null {
    const { idleS, fileS } = this.cfg;
    const idle = (now - this.lastOut) / 1000;
    const onFile = (now - this.fileStart) / 1000;
    const reason = idleS > 0 && idle > idleS ? "idle" : fileS > 0 && onFile > fileS ? "file" : null;
    if (!reason) return null;
    const idx = this.cur ? this.files.indexOf(this.cur) : -1;
    const file = idx >= 0 ? (this.files[idx] as string) : (this.cur ?? this.files[0] ?? "?");
    const at = idx >= 0 ? idx : this.cur ? this.files.length - 1 : 0;
    return {
      reason,
      file,
      lastTest: this.lastTest,
      rest: this.files.slice(at + 1),
      seconds: reason === "idle" ? idle : onFile,
    };
  }
}
