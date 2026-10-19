// PK-FR-05 · PK-FR-10 · PK-NFR-01 · N1 plan §2 "Route hub-api": `GET /pack/<k>/me` ⇒ 200 `{pack, enabled, actions}` kể cả
// khi chưa bật / không quyền (UI: write = có `write`, owner = có `admin`). Đọc cache (0 SQL nóng). Khoá sai dạng ⇒ 404.
import { PackKeySchema, PackMeResponseSchema } from "@ai/contracts";
import { Hono } from "hono";
import { AppError } from "../../../../lib/errors";
import { packActionsFor } from "../domain/pack-access.rules";
import { type PackAccessView, type PackGuardVars, packAccessInput } from "./pack-guard.middleware";

/** Router mount dưới `/pack` (sau `requireAuth`). */
export function packMeRoutes(view: PackAccessView): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  r.get("/:pack_key/me", async (c) => {
    const k = PackKeySchema.safeParse(c.req.param("pack_key"));
    if (!k.success) throw new AppError("NOT_FOUND", 404, "Not found");
    const i = await packAccessInput(view, k.data, c.get("user"));
    return c.json(
      PackMeResponseSchema.parse({
        pack: k.data,
        enabled: i.entitled && !i.featureOff,
        actions: packActionsFor(i),
      }),
    );
  });
  return r;
}
