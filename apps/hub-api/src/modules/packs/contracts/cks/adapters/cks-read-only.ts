// V2-H · intake Q4/C6: CKS (HD9) thay bằng "khách đang dùng" chung ⇒ route GHI của CKS chỉ đọc (410 `CKS_READ_ONLY`) ở tenant v2;
// đọc giữ nguyên, dữ liệu CKS không đụng. Cờ theo tenant `contracts.cks_writable()` (0029) nhớ trong tiến trình 60 s ⇒ request ghi
// nóng không thêm câu SQL (giữ số câu HD9-AC09); nguội ⇒ một tx đọc cờ. Guard quyền gói chạy TRƯỚC (người xem vẫn 403, 0 SQL).
import type { MiddlewareHandler } from "hono";
import { AppError } from "../../../../../lib/errors";
import type { PackGuardVars } from "../../../kit/adapters/pack-guard.middleware";

export const CKS_FLAG_TTL_MS = 60_000;

/** Nhớ cờ theo tenant trong `ttl` ms; nhiều request nguội cùng lúc dùng chung một lượt đọc. */
export function cachedFlag(
  read: (tenantId: string) => Promise<boolean>,
  now: () => number,
  ttl = CKS_FLAG_TTL_MS,
): (tenantId: string) => Promise<boolean> {
  const hit = new Map<string, { at: number; v: Promise<boolean> }>();
  return (tenantId) => {
    const h = hit.get(tenantId);
    if (h && now() - h.at < ttl) return h.v;
    const v = read(tenantId);
    hit.set(tenantId, { at: now(), v });
    v.catch(() => {
      if (hit.get(tenantId)?.v === v) hit.delete(tenantId);
    });
    return v;
  };
}

export const cksReadOnlyError = () =>
  new AppError(
    "CKS_READ_ONLY",
    410,
    "Chữ ký số (CKS) chỉ đọc — theo dõi khách ở Sản phẩm › Khách đang dùng",
  );

/** Guard quyền `write` rồi cờ ghi CKS: chỉ đọc ⇒ 410 trước khi đọc thân. */
export function cksWriteGuard(
  write: MiddlewareHandler<PackGuardVars>,
  writable: (tenantId: string) => Promise<boolean>,
): MiddlewareHandler<PackGuardVars> {
  return (c, next) =>
    write(c, async () => {
      if (!(await writable(c.get("user").tenantId))) throw cksReadOnlyError();
      await next();
    });
}
