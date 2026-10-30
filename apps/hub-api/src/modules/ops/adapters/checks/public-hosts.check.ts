// CR-104 · ops-checks · "Host công khai": GET từng host (hạn 10 s mỗi host, song song), < 400 là sống (như uptime-check.ps1).
// Đếm số LƯỢT liền lỗi từ `d.prev` (giá trị lượt trước trong hub.ops_checks): warn từ `warn` lượt, crit từ `crit` lượt.
import type { OpsCheck, OpsCheckResult } from "../../application/ops.check";
import { publicUrlsFromEnv, thresholds } from "./check-kit";

export const HOST_TIMEOUT_MS = 10_000;

export type HostProbe = { host: string; ok: boolean; detail: string };

const HINT =
  "Kiểm tra tunnel/edge và container: `docker compose ps`, `docker compose logs --tail 100 <dịch vụ>`; thử mở host từ ngoài mạng.";

/** Thuần: `prevConsecutive` = số lượt liền lỗi trước lượt này. */
export function evaluatePublicHosts(
  probes: readonly HostProbe[],
  prevConsecutive: number,
  warn: number,
  crit: number,
): OpsCheckResult {
  const bad = probes.filter((p) => !p.ok);
  const consecutive = bad.length > 0 ? prevConsecutive + 1 : 0;
  const value = { consecutive, hosts: probes.map((p) => ({ host: p.host, ok: p.ok })) };
  if (bad.length === 0)
    return {
      status: "ok",
      value,
      message: `${probes.length}/${probes.length} host công khai sống`,
    };
  const list = bad.map((p) => `${p.host} (${p.detail})`).join(", ");
  const status = consecutive >= crit ? "crit" : consecutive >= warn ? "warn" : "ok";
  return {
    status,
    value,
    message: `${bad.length}/${probes.length} host lỗi, ${consecutive} lượt liền: ${list}`,
    hint: HINT,
  };
}

async function probe(f: typeof fetch, u: URL, signal: AbortSignal): Promise<HostProbe> {
  try {
    const res = await f(u.href, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.any([signal, AbortSignal.timeout(HOST_TIMEOUT_MS)]),
    });
    await res.body?.cancel().catch(() => undefined);
    return { host: u.host, ok: res.status < 400, detail: `HTTP ${res.status}` };
  } catch (err) {
    const to = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return { host: u.host, ok: false, detail: to ? "quá giờ" : "không kết nối được" };
  }
}

export function makePublicHostsCheck(urls: () => URL[] = () => publicUrlsFromEnv()): OpsCheck {
  return {
    key: "public_hosts",
    timeoutMs: HOST_TIMEOUT_MS + 5_000,
    async run(d, cfg) {
      const list = urls();
      if (list.length === 0)
        return {
          status: "unknown",
          message: "chưa cấu hình",
          hint: "Đặt `OPS_PUBLIC_URLS` (danh sách URL cách nhau dấu phẩy) hoặc các `S2_PUBLIC_*_URL` cho hub-api.",
        };
      const t = thresholds("public_hosts", cfg);
      const probes = await Promise.all(list.map((u) => probe(d.fetch, u, d.signal)));
      const pv = d.prev?.public_hosts?.value as { consecutive?: unknown } | null | undefined;
      const prevN = typeof pv?.consecutive === "number" ? pv.consecutive : 0;
      return evaluatePublicHosts(probes, prevN, t.warn ?? 1, t.crit ?? 2);
    },
  };
}

export const publicHostsCheck = makePublicHostsCheck();
