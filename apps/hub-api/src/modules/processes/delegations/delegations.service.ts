// CR-127 · E3 · spec §4.2 · §5.2 · R#43 · uỷ quyền: `/me/delegations` (của mình) và `/tenants/:tid/delegations` (quản trị công ty /
// trưởng phòng đặt thay). Kiểm ở `delegation.rules`; quản trị/trưởng phòng đặt thay ⇒ tự chuyển việc A đang giữ sang B (A tự đặt ⇒
// UI hỏi A, không tự chuyển). Scope user (RLS tenant).
import type {
  CreateDelegationRequest,
  Delegation,
  DelegationListResponse,
} from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../../lib/auth.middleware";
import { appError } from "../../../lib/errors";
import { contractAccess } from "../../packs/kit/public";
import { claimError } from "../core/errors";
import type { ProcessDeps } from "../core/ports";
import {
  type Actor,
  delegationCheck,
  mayManageFor,
  mayViewDelegation,
} from "../domain/tasks/delegation.rules";
import * as repo from "./delegations.repo";

const actorOf = (u: AuthUser): Actor => ({
  userId: u.userId,
  role: u.role === "platform_admin" || u.role === "tenant_admin" ? u.role : "member",
});
const toDto = (d: repo.DelegationView): Delegation => ({
  id: d.id,
  from_user: { id: d.fromUserId, display_name: d.names.from },
  to_user: { id: d.toUserId, display_name: d.names.to },
  from_at: d.fromAt.toISOString(),
  to_at: d.toAt.toISOString(),
  kinds: [...d.kinds],
  created_by: { id: d.createdBy, display_name: d.names.by },
  revoked_at: d.revokedAt ? d.revokedAt.toISOString() : null,
});

export class DelegationsService {
  constructor(private readonly d: Pick<ProcessDeps, "db">) {}

  #tenant(u: AuthUser, tid?: string): string {
    if (tid === undefined || tid === u.tenantId) return u.tenantId;
    if (u.role === "platform_admin") return tid;
    throw appError("NOT_FOUND");
  }
  #tx<T>(u: AuthUser, tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withHubScope(this.d.db, { kind: "user", userId: u.userId, tenantId }, fn);
  }

  async list(u: AuthUser, o: { tid?: string; mine: boolean }): Promise<DelegationListResponse> {
    const tenantId = this.#tenant(u, o.tid);
    const all = actorOf(u).role !== "member";
    const rows = await this.#tx(u, tenantId, (tx) =>
      repo.listDelegations(tx, { tenantId, viewerId: u.userId, all, mine: o.mine }),
    );
    return { items: rows.map(toDto) };
  }

  async create(u: AuthUser, b: CreateDelegationRequest, tid?: string): Promise<Delegation> {
    const tenantId = this.#tenant(u, tid);
    const actor = actorOf(u);
    const fromUserId = b.for_user_id ?? u.userId;
    return this.#tx(u, tenantId, async (tx) => {
      const ctx = await repo.createCtx(tx, { tenantId, fromUserId, toUserId: b.to_user_id });
      const d = {
        fromUserId,
        toUserId: b.to_user_id,
        fromAt: new Date(b.from_at),
        toAt: new Date(b.to_at),
        kinds: b.kinds,
      };
      const signer =
        d.kinds.includes("esign") &&
        ((await contractAccess()?.isSigner(tx, tenantId, b.to_user_id)) ?? false);
      const code = delegationCheck(d, { actor, ...ctx, toIsSigner: signer });
      if (code !== "ok") throw claimError(code);
      if (!ctx.usersOk) throw claimError("DELEGATE_NO_ACCESS");
      const id = await repo.insertDelegation(tx, { tenantId, createdBy: u.userId, d });
      // Quản trị / trưởng phòng đặt thay, khoảng đã bắt đầu ⇒ tự chuyển việc A đang giữ (spec §5.2).
      if (fromUserId !== u.userId && d.fromAt.getTime() <= Date.now())
        await repo.moveOpenWork(tx, { tenantId, fromUserId, toUserId: d.toUserId, kinds: d.kinds });
      const row = await repo.getDelegation(tx, tenantId, id);
      if (!row) throw appError("NOT_FOUND");
      return toDto(row);
    });
  }

  async revoke(u: AuthUser, id: string, tid?: string): Promise<Delegation> {
    const tenantId = this.#tenant(u, tid);
    const actor = actorOf(u);
    return this.#tx(u, tenantId, async (tx) => {
      const row = await repo.getDelegation(tx, tenantId, id);
      const heads = row
        ? (
            await repo.createCtx(tx, {
              tenantId,
              fromUserId: row.fromUserId,
              toUserId: row.toUserId,
            })
          ).headsOfFrom
        : [];
      if (!row || !mayViewDelegation(actor, row, heads)) throw appError("NOT_FOUND");
      if (!mayManageFor(actor, row.fromUserId, heads)) throw claimError("DELEGATE_FORBIDDEN");
      await repo.revokeDelegation(tx, tenantId, id);
      const after = await repo.getDelegation(tx, tenantId, id);
      return toDto(after ?? row);
    });
  }
}
