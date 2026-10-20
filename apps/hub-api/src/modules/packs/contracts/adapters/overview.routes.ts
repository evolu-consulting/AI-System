// V2-K · TQ-01/TQ-02: `GET /pack/contracts/overview?period=month|quarter|12m` (Tổng quan: 4 con số + theo nhóm), `GET /my-work/todo`
// (Cần xử lý 8 nguồn), `POST /my-work/todo/dismiss` { key, action: skip|done } — quyền `read` (việc ẩn là của riêng người bấm, như hẹn
// nhắc W1). Guard TRƯỚC đọc thân; query/thân strict; khoá sai dạng ⇒ 400; hẹn nhắc không phải của mình ⇒ 404.
import { OverviewQuerySchema, TodoDismissSchema, TodoQuerySchema } from "@ai/contracts";
import { type Context, Hono } from "hono";
import { appError } from "../../../../lib/errors";
import { parseQuery, parseWith, readJson } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import { type OverviewUsecase, TodoFail } from "../application/overview.usecase";

const KEY = "contracts";
const who = (c: Context<PackGuardVars>) => {
  const u = c.get("user");
  return { tenantId: u.tenantId, userId: u.userId };
};
const run = <T>(p: Promise<T>): Promise<T> =>
  p.catch((e) => {
    if (!(e instanceof TodoFail)) throw e;
    if (e.kind === "not_found") throw appError("NOT_FOUND");
    throw appError("VALIDATION_ERROR", { key: "invalid" });
  });

export function overviewRoutes(view: PackAccessView, uc: OverviewUsecase): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const read = packGuard(view, KEY, "read");
  r.get("/overview", read, async (c) => {
    const q = parseQuery(c, OverviewQuerySchema);
    return c.json(await uc.overview(who(c), q.period));
  });
  r.get("/my-work/todo", read, async (c) => {
    parseQuery(c, TodoQuerySchema);
    return c.json(await uc.todo(who(c)));
  });
  r.post("/my-work/todo/dismiss", read, async (c) => {
    const b = parseWith(TodoDismissSchema, await readJson(c));
    return c.json(await run(uc.dismiss(who(c), b.key, b.action)));
  });
  return r;
}
