// CR-117 · p95 theo route từ access log của container `web` (nginx, log_format `main_rt` ở deploy/prod-sohoptac2/nginx.conf: dạng
// combined + `rt=$request_time urt=$upstream_response_time`). Thuần, không I/O; `slo-routes.ts` đọc stdin rồi in JSON cho ops-slo-status.sh.

export type RouteDef = { name: string; method: string; path: RegExp };

/** Route có SLO/chẩn đoán. Tên `contracts.list` là khoá check `slo` đọc trong slo.json `routes`. */
export const SLO_ROUTES: readonly RouteDef[] = [
  { name: "contracts.list", method: "GET", path: /^\/pack\/contracts\/contracts\/?$/ },
  {
    name: "contracts.approval",
    method: "GET",
    path: /^\/pack\/contracts\/contracts\/[0-9a-f-]+\/approval\/?$/,
  },
];

export type AccessLine = { method: string; path: string; status: number; rt: number };

const LINE = /"([A-Z]+) (\S+) HTTP\/[\d.]+" (\d{3}) .*? rt=([\d.]+) urt=/;

/** Dòng access log → trường cần dùng; dòng khác định dạng (log cũ không có rt=, dòng lỗi) ⇒ null. `rt` đổi sang ms. */
export function parseLine(line: string): AccessLine | null {
  const m = LINE.exec(line);
  if (!m) return null;
  const [, method, uri, status, rt] = m;
  const path = (uri ?? "").split("?")[0] ?? "";
  const ms = Number(rt) * 1000;
  return Number.isFinite(ms)
    ? { method: method ?? "", path, status: Number(status), rt: ms }
    : null;
}

/** p95 kiểu nearest-rank (phần tử thứ ceil(0.95·n) của dãy tăng dần). Dãy rỗng ⇒ null. */
export function p95(sortedAsc: readonly number[]): number | null {
  if (sortedAsc.length === 0) return null;
  const i = Math.ceil(sortedAsc.length * 0.95) - 1;
  return sortedAsc[Math.min(Math.max(i, 0), sortedAsc.length - 1)] ?? null;
}

export type RouteStat = { n: number; p95_ms: number };

/** Gộp theo route; chỉ tính phản hồi 2xx/3xx (5xx đã nằm ở SLO tỷ lệ lỗi). Route không có request nào ⇒ vắng khỏi kết quả. */
export function routeStats(
  lines: Iterable<string>,
  routes: readonly RouteDef[] = SLO_ROUTES,
): Record<string, RouteStat> {
  const by = new Map<string, number[]>();
  for (const raw of lines) {
    const l = parseLine(raw);
    if (!l || l.status >= 400) continue;
    const r = routes.find((x) => x.method === l.method && x.path.test(l.path));
    if (!r) continue;
    const arr = by.get(r.name) ?? [];
    arr.push(l.rt);
    by.set(r.name, arr);
  }
  const out: Record<string, RouteStat> = {};
  for (const [name, arr] of by) {
    arr.sort((a, b) => a - b);
    out[name] = { n: arr.length, p95_ms: Math.round((p95(arr) ?? 0) * 10) / 10 };
  }
  return out;
}
