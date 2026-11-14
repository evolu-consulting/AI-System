// CR-157: chuyển HĐ DRAFT đọc lỗi sang nhập tay + xác nhận "đã đối chiếu với tệp gốc". Một tx `PackUow` (RLS tenant, khoá hàng);
// quyền như Gửi (người tạo ∪ phụ trách). Mỗi lệnh = 1 khoá + 1 câu ghi (số câu cố định).
import type { PackUow, PackWho } from "../../kit/public";
import { canReconcile, canStartManual } from "../domain/manual-entry.rules";
import type { SubmitTxRepos } from "./submit.usecase";

export type ManualErr = "not_found" | "forbidden" | "busy" | "MANUAL_NOT_ALLOWED" | "NOT_MANUAL";
type Repos = Pick<SubmitTxRepos, "sub">;
type Deps = { uow: PackUow<Repos> };

type Head = NonNullable<Awaited<ReturnType<Repos["sub"]["lock"]>>>;

/** Kiểm chuyển nhập tay (thứ tự = ưu tiên mã lỗi): quyền ⇒ AI đang đọc ⇒ điều kiện DRAFT + failed. */
function startErr(h: Head, who: PackWho): ManualErr | null {
  if (h.createdBy !== who.userId && h.ownerId !== who.userId) return "forbidden";
  const can = canStartManual({ status: h.status, extractState: h.extractState });
  if (can === "busy") return "busy";
  return can === "ok" ? null : "MANUAL_NOT_ALLOWED";
}

export function startManualEntry(d: Deps) {
  return (who: PackWho, id: string) =>
    d.uow.tenant(who, async (r): Promise<{ version: number } | { error: ManualErr }> => {
      const h = await r.sub.lock(id);
      if (!h) return { error: "not_found" };
      const bad = startErr(h, who);
      if (bad) return { error: bad };
      return { version: await r.sub.startManual(id, who.userId) };
    });
}

type ReconcileOut = { by: string | null; at: string | null } | { error: ManualErr };

async function reconcileTx(r: Repos, who: PackWho, id: string, on: boolean): Promise<ReconcileOut> {
  const h = await r.sub.lock(id);
  if (!h) return { error: "not_found" };
  const can = canReconcile(h, who.userId);
  if (can === "forbidden") return { error: "forbidden" };
  if (can !== "ok") return { error: "NOT_MANUAL" };
  const at = await r.sub.setReconciled(id, on ? who.userId : null);
  return { by: on ? who.userId : null, at };
}

export function reconcileEntry(d: Deps) {
  return (who: PackWho, id: string, reconciled: boolean) =>
    d.uow.tenant(who, (r) => reconcileTx(r, who, id, reconciled));
}
