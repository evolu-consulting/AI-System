// app-guide · lớp 4: đăng ký tool `app-guide` vào registry tool gói (gọi từ `mountPacks`). Quyền người gọi lấy từ cổng gói
// (`PackAccessView`) + vai trò trong `admin.users` (cột `role` hub_ro được SELECT).
import type { Db } from "@ai/db";
import { users } from "@ai/db";
import { and, eq } from "drizzle-orm";
import type { PackAccessView } from "../packs/kit/adapters/pack-guard.middleware";
import { packAccessInput } from "../packs/kit/adapters/pack-guard.middleware";
import type { PackToolDef } from "../packs/kit/application/pack-tools.ports";
import { checkPackAccess } from "../packs/kit/domain/pack-access.rules";
import { loadGuide } from "./guide.content";
import { type GuideDeps, guideTools } from "./guide.tools";

export function guideDeps(db: Db, view: PackAccessView): GuideDeps {
  return {
    sections: loadGuide,
    isAdmin: async (who) => {
      const [u] = await db.db
        .select({ role: users.role })
        .from(users)
        .where(and(eq(users.id, who.userId), eq(users.tenantId, who.tenantId)))
        .limit(1);
      return u?.role === "tenant_admin" || u?.role === "platform_admin";
    },
    canReadPack: async (who, pack) => {
      const i = await packAccessInput(view, pack, who);
      return checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction.read }) === "ok";
    },
  };
}

export function mountGuide(
  db: Db,
  tools: { register(t: PackToolDef): void } | undefined,
  view: PackAccessView,
): void {
  if (!tools) return;
  for (const t of guideTools(guideDeps(db, view))) tools.register(t);
}
