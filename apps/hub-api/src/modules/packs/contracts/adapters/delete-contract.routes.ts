// V2-M · HD-07 · C7: `GET /contracts/:id/delete-preview` (hộp xác nhận liệt kê tác động) và `DELETE /contracts/:id` (xoá hẳn, một tx).
// CHỈ quyền `admin` (vai contracts-owner): guard TRƯỚC đọc tham số ⇒ editor/viewer 403; id sai dạng 400; HĐ không có / tenant khác /
// không thấy ⇒ 404; còn phụ lục / gắn CKS / kho không đảo được ⇒ 409 (không xoá gì).
import { DELETE_CONTRACT_ERRORS } from "@ai/contracts";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseWith } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import {
  DeleteContractFail,
  type DeleteContractUsecases,
} from "../application/delete-contract.usecase";

const who = (c: Context<PackGuardVars>) => {
  const u = c.get("user");
  return { tenantId: u.tenantId, userId: u.userId };
};
const MSG = [
  "DELETE_STOCK_BLOCKED",
  "Hàng nhập từ hợp đồng này đã xuất bán nơi khác — không đảo kho được",
] as const;
const run = <T>(p: Promise<T>): Promise<T> =>
  p.catch((e) => {
    if (!(e instanceof DeleteContractFail)) throw e;
    if (e.kind === "not_found") throw appError("NOT_FOUND");
    const [code, msg] = MSG;
    throw new AppError(code, DELETE_CONTRACT_ERRORS[code], `${msg} (${e.detail})`, {
      shortages: e.shortages,
    });
  });

export function deleteContractRoutes(
  view: PackAccessView,
  uc: DeleteContractUsecases,
): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const admin = packGuard(view, "contracts", "admin");
  const id = (c: Context<PackGuardVars>) => parseWith(z.uuid(), c.req.param("id"));
  r.get("/contracts/:id/delete-preview", admin, async (c) =>
    c.json(await run(uc.preview(who(c), id(c)))),
  );
  r.delete("/contracts/:id", admin, async (c) => c.json(await run(uc.remove(who(c), id(c)))));
  return r;
}
