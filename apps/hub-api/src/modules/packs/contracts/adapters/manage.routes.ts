// gap-a1 · route trang chi tiết HĐ (mount dưới `/pack/contracts`): `GET /contracts/:id/history` (read, theo luật thấy của người gọi),
// `GET /assignees` + `PUT /contracts/:id/owner` + `PUT /contracts/:id/commission` + `POST /contracts/:id/summary` (write; AI có trần
// thao tác theo tenant/ngày). Guard TRƯỚC đọc thân/tham số (viewer ⇒ 403, 0 SQL); `:id` sai dạng ⇒ 400; HĐ không thấy / tenant khác ⇒ 404.
import {
  CONTRACT_ERRORS,
  CommissionEditRequestSchema,
  HISTORY_MAX,
  LOCK_ERRORS,
  MANAGE_ERRORS,
  OwnerAssignRequestSchema,
  ReopenRequestSchema,
  VERSION_ERRORS,
} from "@ai/contracts/pack-contracts";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthUser } from "../../../../lib/auth.middleware";
import { AppError, appError } from "../../../../lib/errors";
import { parseWith, readJson } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packAccessInput,
  packGuard,
  packGuardOrPlatform,
  requestWho,
} from "../../kit/adapters/pack-guard.middleware";
import type { PackWho } from "../../kit/application/ports";
import { checkPackAccess } from "../../kit/domain/pack-access.rules";
import type {
  AssignOwner,
  EditCommission,
  GetHistory,
  Summarize,
} from "../application/manage.usecase";
import type { ReopenContract, ReopenOutcome } from "../application/reopen-contract.usecase";

const KEY = "contracts";

export type ManageRoutesDeps = {
  history: GetHistory;
  assignees: (who: PackWho) => Promise<{ id: string; name: string }[]>;
  assign: AssignOwner;
  commission: EditCommission;
  summarize: Summarize;
  /** CR-097 K1 · HD-FR-104 (vắng ⇒ không mount). */
  reopen?: ReopenContract;
  quota?: (tenantId: string) => Promise<void>;
};

/** CR-097 K1 · HD-FR-100: HĐ đã xác nhận ⇒ điều khoản pháp lý/tiền chỉ đọc. */
export const lockedError = () =>
  new AppError(
    "CONTRACT_LOCKED",
    LOCK_ERRORS.CONTRACT_LOCKED,
    "Confirmed contract is locked; only the owner can reopen it",
  );

const whoOf = (u: { tenantId: string; userId: string }): PackWho => ({
  tenantId: u.tenantId,
  userId: u.userId,
});
const idOf = (p: string | undefined) => parseWith(z.uuid(), p);

const isPackAdmin = async (view: PackAccessView, u: AuthUser): Promise<boolean> => {
  const i = await packAccessInput(view, KEY, u);
  return checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction.admin }) === "ok";
};

/** Kết quả "mở lại" không thành công ⇒ lỗi HTTP (404 / 400 / 403 / 409). */
function reopenFail(out: Exclude<ReopenOutcome, { kind: "ok" }>): AppError {
  switch (out.kind) {
    case "not_found":
      return appError("NOT_FOUND");
    case "reason_invalid":
      return new AppError("REASON_REQUIRED", 400, "A reason (1-500 characters) is required");
    case "forbidden":
      return new AppError(
        "REOPEN_FORBIDDEN",
        LOCK_ERRORS.REOPEN_FORBIDDEN,
        "Only the contract owner or a pack owner can reopen it",
      );
    case "not_locked":
      return new AppError(
        "CONTRACT_NOT_LOCKED",
        LOCK_ERRORS.CONTRACT_NOT_LOCKED,
        "Contract is not locked",
      );
    case "draft_exists":
      return new AppError(
        "VERSION_DRAFT_EXISTS",
        VERSION_ERRORS.VERSION_DRAFT_EXISTS,
        "An updated version is pending; discard it before reopening",
      );
  }
}
export function manageRoutes(view: PackAccessView, d: ManageRoutesDeps): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const read = packGuard(view, KEY, "read");
  const write = packGuard(view, KEY, "write");

  r.get("/contracts/:id/history", read, async (c) => {
    const items = await d.history(whoOf(c.get("user")), idOf(c.req.param("id")), HISTORY_MAX);
    if (!items) throw appError("NOT_FOUND");
    return c.json({ items });
  });

  r.get("/assignees", write, async (c) =>
    c.json({ items: await d.assignees(whoOf(c.get("user"))) }),
  );

  r.put("/contracts/:id/owner", write, async (c) => {
    const id = idOf(c.req.param("id"));
    const body = parseWith(OwnerAssignRequestSchema, await readJson(c));
    const out = await d.assign(whoOf(c.get("user")), id, body.owner_user_id);
    if (out.kind === "not_found") throw appError("NOT_FOUND");
    if (out.kind === "owner_invalid")
      throw new AppError("OWNER_INVALID", MANAGE_ERRORS.OWNER_INVALID, "Assignee has no access");
    return c.json({ id, owner_user_id: body.owner_user_id });
  });

  r.put("/contracts/:id/commission", write, async (c) => {
    const id = idOf(c.req.param("id"));
    const body = parseWith(CommissionEditRequestSchema, await readJson(c));
    const out = await d.commission(whoOf(c.get("user")), id, body);
    if (out.kind === "ok")
      return c.json({ id, version: out.version, commission_pct: out.commission_pct });
    if (out.kind === "not_found") throw appError("NOT_FOUND");
    if (out.kind === "not_allowed")
      throw new AppError(
        "COMMISSION_NOT_ALLOWED",
        MANAGE_ERRORS.COMMISSION_NOT_ALLOWED,
        "Commission only for a read referral contract",
      );
    if (out.kind === "locked") throw lockedError();
    throw new AppError("CONTRACT_STALE", CONTRACT_ERRORS.CONTRACT_STALE, "Contract was modified", {
      current: out.current,
      updated_at: out.updated_at,
    });
  });

  // CR-097 K1 · HD-FR-104 · CR-101a (Câu 6): người phụ trách HĐ HOẶC owner gói (`admin`). Guard `write` TRƯỚC đọc thân (viewer ⇒
  // 403, 0 SQL); lý do bắt buộc (400); `admin` từ cache quyền (0 SQL); không phụ trách, không owner ⇒ 403 `REOPEN_FORBIDDEN`.
  const reopen = d.reopen;
  // CR-121 Q-3: platform_admin mở lại HĐ của công ty đích qua CHÍNH route này (`?tenant_id` bắt buộc, lý do ≤ 500, event ghi
  // `by_platform`); guard `packGuardOrPlatform` thay `write` chỉ cho vai đó, vai khác như cũ.
  if (reopen)
    r.post("/contracts/:id/reopen", packGuardOrPlatform(view, KEY, "write"), async (c) => {
      const id = idOf(c.req.param("id"));
      const body = parseWith(ReopenRequestSchema, await readJson(c));
      const who = requestWho(c);
      // `admin` gói chỉ tính cho người thuộc công ty (platform không có nhóm ở công ty đích; quyền của họ do use case xét).
      const admin = who.platform ? false : await isPackAdmin(view, c.get("user"));
      const out = await reopen(who, id, body.reason, { admin, role: c.get("user").role });
      if (out.kind !== "ok") throw reopenFail(out);
      return c.json({ id, status: "needs_review", version: out.version, locked: false });
    });
  r.post("/contracts/:id/summary", write, async (c) => {
    const id = idOf(c.req.param("id"));
    await d.quota?.(c.get("user").tenantId);
    const out = await d.summarize(whoOf(c.get("user")), id);
    if (out.kind === "ok") return c.json({ id, summary: out.summary });
    if (out.kind === "not_found") throw appError("NOT_FOUND");
    if (out.kind === "not_allowed")
      throw new AppError(
        "SUMMARY_NOT_ALLOWED",
        MANAGE_ERRORS.SUMMARY_NOT_ALLOWED,
        "Contract has a summary already or nothing to summarise",
      );
    if (out.kind === "ai_cap")
      throw new AppError("AI_CAP_EXCEEDED", 429, "AI daily token cap reached");
    throw new AppError(
      "SUMMARY_UNAVAILABLE",
      MANAGE_ERRORS.SUMMARY_UNAVAILABLE,
      "Summary could not be generated",
    );
  });
  return r;
}
