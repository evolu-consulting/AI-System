// HUB-FR-67 · spec H4b2 §3 B · plan §3.3 · `GET/PUT/DELETE /studio/api/model-profiles/:id`, `POST /studio/api/model-profiles`.
// `GET /model-profiles` (list) giữ ở `studio.routes.ts` (H4a, D4). Không logic: role đã chặn ở `app.h4a.ts` (403 trước
// parse) → `:id` không uuid ⇒ 400 → parse zod (400) → service.
import {
  ModelProfileUpdateSchema,
  ModelProfileWriteSchema,
  VersionQuerySchema,
} from "@ai/contracts/studio";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { parseAdminQuery, parseJson } from "../../../lib/http";
import { parseUuidParam, uuidParams } from "../studio-params";
import type { ProfilesService } from "./profiles.service";

export function profileRoutes(svc: ProfilesService): Hono<AuthVars> {
  const r = new Hono<AuthVars>();
  r.use("/model-profiles/:id", uuidParams("id"));
  r.use("/model-profiles/:id/*", uuidParams("id"));
  r.post("/model-profiles", async (c) =>
    c.json(await svc.create(c.var.user, await parseJson(c, ModelProfileWriteSchema)), 201),
  );
  r.get("/model-profiles/:id", async (c) => c.json(await svc.get(parseUuidParam(c))));
  r.put("/model-profiles/:id", async (c) => {
    const id = parseUuidParam(c);
    return c.json(await svc.update(c.var.user, id, await parseJson(c, ModelProfileUpdateSchema)));
  });
  r.delete("/model-profiles/:id", async (c) => {
    const id = parseUuidParam(c);
    const { version } = parseAdminQuery(c, VersionQuerySchema);
    await svc.remove(c.var.user, id, version);
    return c.body(null, 204);
  });
  return r;
}
