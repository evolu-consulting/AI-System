// CR-121 C-7 · `GET /pack/nav` — MỘT lần gọi cho menu của mọi app: gom song song nguồn của các gói công ty người xem ĐANG BẬT
// (`packEnabled`, cache 0 SQL). Gói tắt ⇒ không gọi; một nguồn lỗi ⇒ chỉ mục của gói đó ẩn (fail-closed), không làm hỏng menu.
// Mỗi nguồn tự kiểm quyền người xem + lọc `tenant_id` của người gọi (xem `PackNavSource`). Không poll: web tải lại khi cần.
import { PackNavResponseSchema } from "@ai/contracts/packs";
import { Hono } from "hono";
import type { PackNavRegistry } from "../application/pack-nav.ports";
import { type PackAccessView, type PackGuardVars, packEnabled } from "./pack-guard.middleware";
import { packNavRegistry } from "./pack-nav-registry";

/** Router mount dưới `/pack` (sau `requireAuth`). `registry` để test tiêm. */
export function packNavRoutes(
  view: PackAccessView,
  registry: PackNavRegistry = packNavRegistry,
): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  r.get("/nav", async (c) => {
    const user = c.get("user");
    const lists = await Promise.all(
      registry.sources().map(async (s) => {
        if (!(await packEnabled(view, s.pack, user.tenantId))) return [];
        return s.caps(user).catch(() => []);
      }),
    );
    return c.json(PackNavResponseSchema.parse({ items: lists.flat() }));
  });
  return r;
}
