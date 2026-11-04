// dlc-agent-flows · `GET /studio/api/dlc-flows` (def thư viện đã xuất bản của 3 khe DLC — Select "Quy trình dùng khi agent mở
// lượt") + `GET /studio/api/pack-tools` (tool gói agent gắn được — ô tick "Quy trình DLC"). Role chặn ở `app.h4a.ts`.
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import type { DlcFlowsService } from "./dlc-flows.service";

export function dlcFlowRoutes(svc: DlcFlowsService): Hono<AuthVars> {
  const r = new Hono<AuthVars>();
  r.get("/dlc-flows", async (c) => c.json(await svc.flows()));
  r.get("/pack-tools", (c) => c.json(svc.packTools()));
  return r;
}
