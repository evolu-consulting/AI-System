// CR-121 T-1 · gom thời lượng từ kết quả evotest (JUnit int, report.json Playwright) vào cache của cổng đợt. Hàm thuần.
import { baseJobName } from "./e2e-pieces.rules";
import type { WaveTimings } from "./wave-plan.rules";

/** Ca đỏ/timeout chiếm đủ 30 s chờ hết giờ - không phản ánh thời gian chạy xanh ⇒ tính bằng mức này. */
export const RED_CASE_S = 8;

/**
 * JUnit của bun 1.3.14 ghi `time="0"` cho cấp file ⇒ thời lượng file = tổng `<testcase time>` + phần chung (beforeAll/import) chia đều:
 * (thời gian cả lô − tổng ca) / số file. Chỉ dùng khi chưa có số đo header→header (`Run.fileMs`, ghi ở int-timings.json).
 */
export function intFromJunit(xml: string): Record<string, number> {
  const per: Record<string, number> = {};
  let sum = 0;
  for (const m of xml.matchAll(/<testcase\s[^>]*?time="([\d.]+)"[^>]*?file="([^"]+)"/g)) {
    const s = Number(m[1]);
    per[m[2] ?? ""] = (per[m[2] ?? ""] ?? 0) + s;
    sum += s;
  }
  const files = Object.keys(per);
  const wall = Number(/<testsuites[^>]*\stime="([\d.]+)"/.exec(xml)?.[1] ?? 0);
  const share = files.length && wall > sum ? (wall - sum) / files.length : 0;
  return Object.fromEntries(
    files.map((f) => [f, Math.round((per[f] ?? 0) * 10 + share * 10) / 10]),
  );
}

type Spec = {
  file: string;
  tests?: { results?: { duration?: number; status?: string }[] }[];
};
type Suite = { specs?: Spec[]; suites?: Suite[] };
export type PwReport = { stats?: { duration?: number }; suites?: Suite[] };

const isGreen = (status?: string) => status === "passed" || status === "skipped";

function eachSpec(s: Suite, f: (sp: Spec) => void): void {
  for (const sp of s.specs ?? []) f(sp);
  for (const c of s.suites ?? []) eachSpec(c, f);
}

/** Giây mỗi file spec (ca không xanh tính RED_CASE_S) + giây dựng stack (= thời gian cả việc − tổng ca, kẹp 5..90). */
export function e2eFromReport(rep: PwReport): { files: Record<string, number>; boot: number } {
  const files: Record<string, number> = {};
  let raw = 0;
  for (const s of rep.suites ?? [])
    eachSpec(s, (sp) => {
      for (const r of (sp.tests ?? []).flatMap((t) => t.results ?? [])) {
        const d = (r.duration ?? 0) / 1000;
        raw += d;
        files[sp.file] = (files[sp.file] ?? 0) + (isGreen(r.status) ? d : Math.min(d, RED_CASE_S));
      }
    });
  for (const f of Object.keys(files)) files[f] = Math.round((files[f] ?? 0) * 10) / 10;
  const wall = (rep.stats?.duration ?? 0) / 1000;
  return { files, boot: Math.round(Math.min(90, Math.max(5, wall - raw))) };
}

/** Khoá cache e2e: root dùng `e2e/<file>` (cùng quy ước e2e-timings.json), việc khác `<việc>:<file>`. */
export const e2eKey = (job: string, file: string): string =>
  baseJobName(job) === "root" ? `e2e/${file}` : `${baseJobName(job)}:${file}`;

/** Ghi đè các khoá có số đo mới vào cache (giữ khoá cũ: lượt lẻ chỉ chạy vài mảnh không được làm mất số đo của mảnh khác). */
export function mergeTimings(
  old: WaveTimings,
  patch: {
    int?: Record<string, number>;
    jobs?: Record<string, { files: Record<string, number>; boot: number }>;
  },
): WaveTimings {
  const t: WaveTimings = { int: { ...old.int }, e2e: { ...old.e2e }, boot: { ...old.boot } };
  Object.assign(t.int, patch.int ?? {});
  const byBase = new Map<string, { files: Record<string, number>; boot: number; n: number }>();
  for (const [name, v] of Object.entries(patch.jobs ?? {})) {
    const b = baseJobName(name);
    const cur = byBase.get(b) ?? { files: {}, boot: 0, n: 0 };
    for (const [f, s] of Object.entries(v.files)) cur.files[e2eKey(name, f)] = s;
    cur.boot += v.boot;
    cur.n += 1;
    byBase.set(b, cur);
  }
  for (const [b, v] of byBase) {
    Object.assign(t.e2e, v.files);
    t.boot[b] = Math.round(v.boot / Math.max(1, v.n)); // trung bình các mảnh (mảnh chạy lúc tải cao không kéo cả việc)
  }
  return t;
}
