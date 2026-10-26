// CR-097 G1 · GD-FR-01…05: route Giao dịch dưới `/pack/contracts` (quyền: `read` cho GET, `write` cho còn lại — như HĐ; người xem
// ⇒ 403 trước khi đọc thân). Id sai dạng ⇒ 400; không có / không thấy / tenant khác ⇒ 404; sai trạng thái ⇒ 409 `TRANSACTION_STATE`;
// kho không đủ / không đảo được ⇒ 409 `TRANSACTION_STOCK`; dòng/SP/hạn gói sai ⇒ 422 `TRANSACTION_INVALID`.
//   GET    /transactions                 danh sách (lọc trạng thái/loại/đối tác/HĐ/khoảng ngày, phân trang)
//   POST   /transactions                 tạo nháp
//   GET    /transactions/:id             chi tiết (dòng bản hiện hành + nghĩa vụ + vết)
//   PATCH  /transactions/:id             sửa nháp
//   DELETE /transactions/:id             xoá nháp
//   POST   /transactions/:id/post        ghi sổ
//   PATCH  /transactions/:id/describe    mô tả sau ghi sổ
//   POST   /transactions/:id/adjust      điều chỉnh số liệu (lý do)
//   POST   /transactions/:id/cancel      huỷ (lý do)
import {
  TRANSACTION_ERRORS,
  TransactionAdjustSchema,
  TransactionCancelSchema,
  TransactionDescribeSchema,
  TransactionDraftPatchSchema,
  TransactionDraftSchema,
  TransactionListQuerySchema,
} from "@ai/contracts";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseWith, readJson } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import { type TransactionsUsecase, TxRuleError } from "../application/transactions.usecase";

const KEY = "contracts";
const who = (c: Context<PackGuardVars>) => {
  const u = c.get("user");
  return { tenantId: u.tenantId, userId: u.userId };
};
const idOf = (c: Context<PackGuardVars>) => parseWith(z.uuid(), c.req.param("id"));
const isPg = (e: unknown, code: string) =>
  typeof e === "object" && e !== null && (e as { code?: unknown }).code === code;

const run = <T>(p: Promise<T>): Promise<T> =>
  p.catch((e) => {
    if (e instanceof TxRuleError) {
      if (e.kind === "not_found") throw appError("NOT_FOUND");
      if (e.kind === "state")
        throw new AppError("TRANSACTION_STATE", TRANSACTION_ERRORS.TRANSACTION_STATE, e.detail);
      if (e.kind === "stock")
        throw new AppError("TRANSACTION_STOCK", TRANSACTION_ERRORS.TRANSACTION_STOCK, e.detail);
      throw new AppError("TRANSACTION_INVALID", TRANSACTION_ERRORS.TRANSACTION_INVALID, e.detail);
    }
    // Lưới an toàn 0051 (`g1_transactions_guard`): đua hai lệnh trên cùng giao dịch.
    if (isPg(e, "EG409") || isPg(e.cause, "EG409"))
      throw new AppError("TRANSACTION_STATE", TRANSACTION_ERRORS.TRANSACTION_STATE, "state");
    throw e;
  });

export function transactionsRoutes(
  view: PackAccessView,
  d: { transactions: TransactionsUsecase },
): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const read = packGuard(view, KEY, "read");
  const write = packGuard(view, KEY, "write");
  const u = d.transactions;
  r.get("/transactions", read, async (c) =>
    c.json(await run(u.list(who(c), parseWith(TransactionListQuerySchema, c.req.query())))),
  );
  r.post("/transactions", write, async (c) => {
    const body = parseWith(TransactionDraftSchema, await readJson(c));
    return c.json(await run(u.create(who(c), body)), 201);
  });
  r.get("/transactions/:id", read, async (c) => c.json(await run(u.get(who(c), idOf(c)))));
  r.patch("/transactions/:id", write, async (c) => {
    const id = idOf(c);
    const body = parseWith(TransactionDraftPatchSchema, await readJson(c));
    return c.json(await run(u.patchDraft(who(c), id, body)));
  });
  r.delete("/transactions/:id", write, async (c) => {
    await run(u.remove(who(c), idOf(c)));
    return c.body(null, 204);
  });
  r.post("/transactions/:id/post", write, async (c) => c.json(await run(u.post(who(c), idOf(c)))));
  r.patch("/transactions/:id/describe", write, async (c) => {
    const id = idOf(c);
    const body = parseWith(TransactionDescribeSchema, await readJson(c));
    return c.json(await run(u.describe(who(c), id, body)));
  });
  r.post("/transactions/:id/adjust", write, async (c) => {
    const id = idOf(c);
    const body = parseWith(TransactionAdjustSchema, await readJson(c));
    return c.json(await run(u.adjust(who(c), id, body)));
  });
  r.post("/transactions/:id/cancel", write, async (c) => {
    const id = idOf(c);
    const body = parseWith(TransactionCancelSchema, await readJson(c));
    return c.json(await run(u.cancel(who(c), id, body.reason)));
  });
  return r;
}
