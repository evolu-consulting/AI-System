// V2-H · `GET /products/:id/customers?status=` (quyền `read`), `POST /products/:id/customers/:customerId/remind` (quyền `read`: việc
// của riêng người bấm, như hẹn nhắc W1), `GET /business-settings` (`read`), `PUT /business-settings` (`admin` — Q3: chỉ quản lý chỉnh
// Cài đặt). Guard TRƯỚC đọc thân/tham số; id sai dạng ⇒ 400; SP / khách không có hoặc không thấy ⇒ 404; thân/query strict.
import { BusinessSettingsSchema, ServiceCustomersQuerySchema } from "@ai/contracts";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { appError } from "../../../../lib/errors";
import { parseQuery, parseWith, readJson } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import {
  ServiceCustomersFail,
  type ServiceCustomersUsecases,
} from "../application/service-customers.usecase";

const KEY = "contracts";
const who = (c: Context<PackGuardVars>) => {
  const u = c.get("user");
  return { tenantId: u.tenantId, userId: u.userId };
};
const id = (c: Context<PackGuardVars>, name: string) => parseWith(z.uuid(), c.req.param(name));
const run = <T>(p: Promise<T>): Promise<T> =>
  p.catch((e) => {
    if (e instanceof ServiceCustomersFail) throw appError("NOT_FOUND");
    throw e;
  });

export function serviceCustomersRoutes(
  view: PackAccessView,
  uc: ServiceCustomersUsecases,
): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const read = packGuard(view, KEY, "read");
  const admin = packGuard(view, KEY, "admin");
  r.get("/products/:id/customers", read, async (c) => {
    const pid = id(c, "id");
    const q = parseQuery(c, ServiceCustomersQuerySchema);
    return c.json(await run(uc.list(who(c), pid, q.status ?? "all")));
  });
  r.post("/products/:id/customers/:customerId/remind", read, async (c) => {
    const pid = id(c, "id");
    const cid = id(c, "customerId");
    return c.json(await run(uc.remind(who(c), pid, cid)), 201);
  });
  r.get("/business-settings", read, async (c) => c.json(await uc.settings(who(c))));
  r.put("/business-settings", admin, async (c) => {
    const b = parseWith(BusinessSettingsSchema, await readJson(c));
    return c.json(await uc.saveSettings(who(c), b));
  });
  return r;
}
