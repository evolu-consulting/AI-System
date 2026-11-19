// CR-161 · lát 5 · use case kết nối hai công ty (spec §2 R2–R7, R10; §3). Một use case = một tx theo scope tenant (`PackUow`), số câu SQL cố
// định (không phụ thuộc số hàng). Quyền người dùng (R1: chỉ Toàn quyền) do `packGuard` ở route — use case KHÔNG tự kiểm vai.
// `cc.link` (`/me/stream`) phát SAU commit tới người Toàn quyền hai công ty (một pipeline Redis); lỗi Redis chỉ log, không ném.
import type { ConnectCompany, ConnectLink, ConnectStatus } from "@ai/contracts/pack-contracts";
import type { PackStreamFrame, PackStreamPublishMany, PackUow, PackWho } from "../../../kit/public";
import { type Cursor, encodeCursor } from "../domain/connect.codec";
import type { CcOwner, ConnectRepo } from "./connect.ports";

export type ConnectRepos = { connect: ConnectRepo };
export type ConnectDeps = {
  uow: PackUow<ConnectRepos>;
  /** Tên hiển thị của người gọi (lưu vào lời mời: «ai mời»). */
  selfName: (who: PackWho) => Promise<string>;
  /** Vắng (không Redis) ⇒ không phát. */
  publish?: PackStreamPublishMany | undefined;
};
export type Page<T> = { items: T[]; next_cursor: string | null };

/** `cc.link`: mỗi công ty nhận trạng thái NHÌN TỪ PHÍA MÌNH về công ty kia; người nhận = người Toàn quyền (tab khác của người thao tác cũng nhận). */
function linkFrames(
  owners: readonly CcOwner[],
  a: string,
  b: string,
  statusOf: { a: ConnectStatus; b: ConnectStatus },
): PackStreamFrame[] {
  const side = (self: string, other: string, status: ConnectStatus): PackStreamFrame[] => {
    const userIds = [...new Set(owners.filter((o) => o.tenant_id === self).map((o) => o.user_id))];
    return userIds.length === 0
      ? []
      : [{ userIds, event: "cc.link", data: { tenant_id: other, status } }];
  };
  return [...side(a, b, statusOf.a), ...side(b, a, statusOf.b)];
}

export function connectUsecases(d: ConnectDeps) {
  const emit = async (frames: PackStreamFrame[]): Promise<void> => {
    if (d.publish && frames.length > 0) await d.publish(frames).catch(() => undefined);
  };
  const page = <T extends { tenant_id: string }>(
    rows: T[],
    limit: number,
    at: (r: T) => string,
  ): Page<T> => {
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      next_cursor:
        rows.length > limit && last ? encodeCursor({ t: at(last), id: last.tenant_id }) : null,
    };
  };

  return {
    /** R2 · tìm trong Danh bạ. */
    search: (who: PackWho, q: string): Promise<ConnectCompany[]> =>
      d.uow.tenant(who, (r) => r.connect.search(q)),

    /** R3 · gửi lời mời. Trả trạng thái nhìn từ bên mời. Chặn-trước (B chặn A trước khi A mời): DB trả `pending_out` im lặng, không ghi gì,
     *  và B không nằm trong danh sách người nhận stream (chưa có lời mời) — xem spec R3. */
    async invite(who: PackWho, to: string, note: string | null): Promise<ConnectStatus> {
      const name = await d.selfName(who);
      const out = await d.uow.tenant(who, async (r) => {
        const status = await r.connect.invite(to, note, who.userId, name);
        const owners =
          status === "pending_out" || status === "connected"
            ? await r.connect.owners([who.tenantId, to])
            : [];
        return { status, owners };
      });
      const { status, owners } = out;
      if (status === "pending_out")
        await emit(linkFrames(owners, who.tenantId, to, { a: "pending_out", b: "pending_in" }));
      else if (status === "connected")
        await emit(linkFrames(owners, who.tenantId, to, { a: "connected", b: "connected" }));
      return status;
    },

    /** R4 · đồng ý lời mời của `from` (bên nhận = tenant hiện tại). Chỉ phát `cc.link` khi kết quả là đã kết nối hai chiều. */
    async accept(who: PackWho, from: string): Promise<void> {
      const owners = await d.uow.tenant(who, async (r) => {
        await r.connect.accept(from);
        return (await r.connect.connected(from)) ? r.connect.owners([who.tenantId, from]) : [];
      });
      await emit(linkFrames(owners, who.tenantId, from, { a: "connected", b: "connected" }));
    },

    /** R5 · từ chối. Không báo bên mời (Q3): chỉ làm tươi các tab của chính công ty từ chối. */
    async decline(who: PackWho, from: string): Promise<void> {
      const owners = await d.uow.tenant(who, async (r) => {
        await r.connect.block(from);
        return r.connect.owners([who.tenantId]);
      });
      await emit(linkFrames(owners, who.tenantId, from, { a: "none", b: "none" }));
    },

    /** R6 · ngắt kết nối + audit cùng tx (ghi audit lỗi ⇒ rollback cả ngắt). Người nhận stream lấy TRƯỚC khi ngắt (sau ngắt DB không cho tra
     *  người của công ty kia). */
    async disconnect(who: PackWho, other: string): Promise<void> {
      const owners = await d.uow.tenant(who, async (r) => {
        const o = await r.connect.owners([who.tenantId, other]);
        await r.connect.disconnect(other);
        await r.connect.auditDisconnect(who.userId, other);
        return o;
      });
      await emit(linkFrames(owners, who.tenantId, other, { a: "none", b: "none" }));
    },

    /** Danh sách kết nối: xin `limit + 1` để biết còn trang. */
    async links(
      who: PackWho,
      q: { status?: string | undefined; cursor: Cursor | null; limit: number },
    ): Promise<Page<ConnectLink>> {
      const rows = await d.uow.tenant(who, (r) =>
        r.connect.links(q.status ?? null, q.cursor, q.limit + 1),
      );
      return page(rows, q.limit, (x) => x.since);
    },
  };
}
export type ConnectUsecases = ReturnType<typeof connectUsecases>;
