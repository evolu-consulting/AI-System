// CR-127 · P2 · BR-60…65 · spec §2.4, §3 #12–#14c · API phiên ký chung của app Hợp đồng (chỉ mỏng: mọi đổi trạng thái đi qua hàm DEFINER
// `hub.sign_session_*`, phía suy từ `app.tenant_id`; tenant ngoài phiên không thấy HĐ ⇒ 404):
//   GET  /contracts/:id/sign-session          — trạng thái phiên (tên công ty + người ký hai bên) + người ký chọn được (read)
//   POST /contracts/:id/sign-session/cancel   — «Huỷ phiên ký» (write; cần lý do) — hai bên về DRAFT (bộ chuyển báo bên kia)
//   POST /contracts/:id/sign-session/respond  — bên NHẬN: Đồng ý (chọn người ký phía công ty của quy trình Nhận HĐ) / Xử lý bình thường / Từ chối (write; phụ trách HĐ hoặc admin)
import type { Db, Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { AppError, appError } from "../../../lib/errors";
import { parseWith, readJson } from "../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  type PackUow,
  packAccessInput,
  packActionsFor,
  packGuard,
} from "../kit/public";
import { receiveFlowOf, signerMembersOf } from "./adapters/receive-flow.repo";
import { type SignSessionView, signSessionRepo } from "./adapters/sign-session.repo";
import {
  SIGN_SESSION_HTTP,
  type SignSessionError,
  signSessionErrorOf,
} from "./domain/sign-session.rules";

const KEY = "contracts";
const UUID = z.uuid();
const Cancel = z.strictObject({ reason: z.string().trim().min(1).max(1000) });
const Respond = z.strictObject({
  choice: z.enum(["accept", "normal", "decline"]),
  signer_user_id: z.uuid().optional(),
  reason: z.string().trim().max(1000).optional(),
});

const MSG: Record<
  SignSessionError | "SIGNER_REQUIRED" | "SIGNER_NOT_IN_GROUP" | "NO_SIGN_NODE" | "FORBIDDEN",
  string
> = {
  SESSION_NOT_ACTIVE: "Phiên ký đã kết thúc hoặc chưa tới bước này — tải lại trang.",
  SESSION_FORBIDDEN: "Hợp đồng này không thuộc phiên ký chung của công ty bạn.",
  SESSION_HASH_MISMATCH: "Văn bản ký khác bản đã thống nhất — huỷ phiên ký và gửi lại.",
  SIGNER_REQUIRED: "Chọn người ký phía công ty rồi bấm Đồng ý.",
  SIGNER_NOT_IN_GROUP:
    "Người ký phải là người ký phía công ty đã đặt trong quy trình Nhận HĐ — chọn lại.",
  NO_SIGN_NODE: "Quy trình Nhận HĐ chưa có bước Ký.",
  FORBIDDEN:
    "Chỉ người phụ trách hợp đồng nhận hoặc quản trị công ty được trả lời đề nghị ký cùng lúc.",
};
const fail = (code: keyof typeof MSG, http: 403 | 409 | 422): never => {
  throw new AppError(code, http, MSG[code]);
};
const sessionFail = (e: unknown): never => {
  const code = signSessionErrorOf(e);
  if (!code) throw e;
  return fail(code, SIGN_SESSION_HTTP[code] as 403 | 409 | 422);
};

type Uow = PackUow<{ tx: Tx; tid: string }>;
const who = (c: { get(k: "user"): { tenantId: string; userId: string } }) => ({
  tenantId: c.get("user").tenantId,
  userId: c.get("user").userId,
});

type Members = () => Promise<{ id: string; name: string }[]>;
type RespondIn = {
  id: string;
  b: z.infer<typeof Respond>;
  u: { userId: string };
  isAdmin: boolean;
  signersOf: Members;
};

/** Chỉ người phụ trách HĐ hoặc quản trị công ty được trả lời / huỷ phiên ký của HĐ (MỘT luật cho cả hai route). HĐ không thấy ⇒ 404. */
export async function assertOwnerOrAdmin(
  x: { tx: Tx; tid: string },
  i: { id: string; userId: string; isAdmin: boolean },
): Promise<void> {
  const [o] = await x.tx.execute<{ owner: string | null }>(
    sql`select owner_user_id::text as owner from contracts.contracts where id = ${i.id}::uuid and tenant_id = ${x.tid}::uuid`,
  );
  if (!o) throw appError("NOT_FOUND");
  if (!i.isAdmin && o.owner !== i.userId) fail("FORBIDDEN", 403);
}

/** Người ký chọn phải là «Người ký phía công ty» của bước Ký trong quy trình Nhận HĐ (CR-146b). */
async function signerNameOf(_x: { tx: Tx; tid: string }, i: RespondIn): Promise<string | null> {
  if (!i.b.signer_user_id) return fail("SIGNER_REQUIRED", 422);
  const hit = (await i.signersOf()).find((m) => m.id === i.b.signer_user_id);
  if (!hit) return fail("SIGNER_NOT_IN_GROUP", 422);
  return hit.name;
}

/** Trả lời đề nghị ký cùng lúc trong tx gói; hàm DEFINER kiểm phía + trạng thái phiên. */
async function respondTx(x: { tx: Tx; tid: string }, i: RespondIn): Promise<void> {
  await assertOwnerOrAdmin(x, { id: i.id, userId: i.u.userId, isAdmin: i.isAdmin });
  const repo = signSessionRepo(x.tx, x.tid);
  const sid = await repo.sessionOf(i.id);
  if (!sid) throw appError("NOT_FOUND");
  if (i.b.choice === "accept") await repo.accept(sid, await signerNameOf(x, i));
  else if (i.b.choice === "normal") await repo.fallback(sid);
  else await repo.decline(sid, i.b.reason || null);
}

export function signSessionRoutes(db: Db, view: PackAccessView, uow: Uow): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  /** CR-146b · quy trình Nhận HĐ chưa có bước Ký / chưa chọn người ký ⇒ lỗi nghiệp vụ `NO_SIGN_NODE` (422). */
  const signersOf = async (
    c: { get(k: "user"): { tenantId: string; userId: string } },
    required: boolean,
  ) => {
    const { signers } = await receiveFlowOf(db, who(c).tenantId);
    if (!signers) return required ? fail("NO_SIGN_NODE", 422) : [];
    return signerMembersOf(db, who(c).tenantId, signers);
  };

  r.get("/contracts/:id/sign-session", packGuard(view, KEY, "read"), async (c) => {
    const id = parseWith(UUID, c.req.param("id"));
    const out = await uow.tenant(who(c), async (x) => {
      const sid = await signSessionRepo(x.tx, x.tid).sessionOf(id);
      if (!sid) return null;
      const s: SignSessionView | null = await signSessionRepo(x.tx, x.tid).mine(sid);
      return s ? { s } : null;
    });
    // HĐ chưa/không có phiên ký chung ⇒ 200 `{session:null}` (không phải lỗi; trang chi tiết gọi cho mọi HĐ).
    if (!out) return c.json({ session: null, signers: [] }, 200);
    const signers =
      out.s.side === "to" && out.s.status === "proposed" ? await signersOf(c, false) : [];
    return c.json({ session: out.s, signers }, 200);
  });

  r.post("/contracts/:id/sign-session/cancel", packGuard(view, KEY, "write"), async (c) => {
    const id = parseWith(UUID, c.req.param("id"));
    const b = parseWith(Cancel, await readJson(c));
    const isAdmin = packActionsFor(await packAccessInput(view, KEY, c.get("user"))).includes(
      "admin",
    );
    await uow
      .tenant(who(c), async (x) => {
        await assertOwnerOrAdmin(x, { id, userId: c.get("user").userId, isAdmin });
        const repo = signSessionRepo(x.tx, x.tid);
        const sid = await repo.sessionOf(id);
        if (!sid) throw appError("NOT_FOUND");
        await repo.cancel(sid, b.reason);
      })
      .catch(sessionFail);
    return c.json({ ok: true }, 200);
  });

  r.post("/contracts/:id/sign-session/respond", packGuard(view, KEY, "write"), async (c) => {
    const id = parseWith(UUID, c.req.param("id"));
    const b = parseWith(Respond, await readJson(c));
    const u = c.get("user");
    const isAdmin = packActionsFor(await packAccessInput(view, KEY, u)).includes("admin");
    await uow
      .tenant(who(c), (x) =>
        respondTx(x, { id, b, u, isAdmin, signersOf: () => signersOf(c, true) }),
      )
      .catch(sessionFail);
    return c.json({ ok: true }, 200);
  });
  return r;
}
