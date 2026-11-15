// CR-161 · lát 5 · use case kết nối (uow giả): khung `cc.link` phát SAU commit tới đúng người Toàn quyền; chặn-trước ⇒ bên bị chặn không nhận;
// ngắt lấy người nhận TRƯỚC khi ngắt + ghi audit cùng tx; trang danh sách xin limit+1.
import { describe, expect, it } from "bun:test";
import type { PackStreamFrame, PackUow } from "../../../kit/public";
import { decodeCursor } from "../domain/connect.codec";
import type { ConnectRepo } from "./connect.ports";
import { type ConnectRepos, connectUsecases } from "./connect.usecase";

const A = "7e5d00a1-0000-4000-8000-000000000001";
const B = "7e5d00a1-0000-4000-8000-000000000002";
const U1 = "7e5d00a2-0000-4000-8000-000000000001";
const U2 = "7e5d00a2-0000-4000-8000-000000000002";
const U3 = "7e5d00a2-0000-4000-8000-000000000003";
const who = { tenantId: A, userId: U1 };

function setup(over: Partial<ConnectRepo>) {
  const log: string[] = [];
  const frames: PackStreamFrame[][] = [];
  const connect = {
    owners: async (t: readonly string[]) => {
      log.push(`owners:${t.join("+")}`);
      return [
        { tenant_id: A, user_id: U1 },
        { tenant_id: A, user_id: U3 },
        { tenant_id: B, user_id: U2 },
      ];
    },
    ...over,
  } as unknown as ConnectRepo;
  const uow: PackUow<ConnectRepos> = {
    tenant: async (_w, fn) => {
      log.push("begin");
      const out = await fn({ connect, posts: {} as never });
      log.push("commit");
      return out;
    },
  };
  const uc = connectUsecases({
    uow,
    selfName: async () => "Tiên",
    publish: async (f) => {
      log.push("publish");
      frames.push([...f]);
    },
  });
  return { uc, log, frames };
}

describe("CR-161 · cc.link sau commit", () => {
  it("mời ⇒ pending_out cho bên mời, pending_in cho bên nhận; phát sau commit", async () => {
    const { uc, log, frames } = setup({ invite: async () => "pending_out" });
    expect(await uc.invite(who, B, "xin chào")).toBe("pending_out");
    expect(log).toEqual(["begin", `owners:${A}+${B}`, "commit", "publish"]);
    expect(frames[0]).toEqual([
      { userIds: [U1, U3], event: "cc.link", data: { tenant_id: B, status: "pending_out" } },
      { userIds: [U2], event: "cc.link", data: { tenant_id: A, status: "pending_in" } },
    ]);
  });
  it("chặn-trước: DB trả pending_out nhưng bên kia không có trong danh sách người nhận ⇒ chỉ tab của bên mời nhận", async () => {
    const { uc, frames } = setup({
      invite: async () => "pending_out",
      owners: async () => [{ tenant_id: A, user_id: U1 }],
    });
    await uc.invite(who, B, null);
    expect(frames[0]).toEqual([
      { userIds: [U1], event: "cc.link", data: { tenant_id: B, status: "pending_out" } },
    ]);
  });
  it("409/422 (declined, not listed) ⇒ ném, không phát", async () => {
    const { uc, frames } = setup({
      invite: async () => {
        throw new Error("CC409");
      },
    });
    await expect(uc.invite(who, B, null)).rejects.toThrow();
    expect(frames).toHaveLength(0);
  });
  it("đồng ý một chiều (đường cũ, chưa connected) ⇒ không phát; connected ⇒ phát cả hai phía", async () => {
    const one = setup({ accept: async () => true, connected: async () => false });
    await one.uc.accept(who, B);
    expect(one.frames).toHaveLength(0);
    const both = setup({ accept: async () => true, connected: async () => true });
    await both.uc.accept(who, B);
    expect(both.frames[0]?.map((f) => f.data)).toEqual([
      { tenant_id: B, status: "connected" },
      { tenant_id: A, status: "connected" },
    ]);
  });
  it("từ chối: chỉ làm tươi tab của công ty từ chối (không báo bên mời)", async () => {
    const { uc, frames } = setup({
      block: async () => true,
      owners: async () => [{ tenant_id: A, user_id: U1 }],
    });
    await uc.decline(who, B);
    expect(frames[0]).toEqual([
      { userIds: [U1], event: "cc.link", data: { tenant_id: B, status: "none" } },
    ]);
  });
  it("ngắt: người nhận lấy TRƯỚC khi ngắt, audit cùng tx, rồi phát none cho cả hai", async () => {
    const calls: string[] = [];
    const { uc, frames, log } = setup({
      disconnect: async () => {
        calls.push("disconnect");
        return true;
      },
      auditDisconnect: async (actor: string, other: string) => {
        calls.push(`audit:${actor}:${other}`);
      },
    });
    await uc.disconnect(who, B);
    expect(calls).toEqual(["disconnect", `audit:${U1}:${B}`]);
    expect(log.indexOf(`owners:${A}+${B}`)).toBeLessThan(log.indexOf("commit"));
    expect(frames[0]?.map((f) => f.data)).toEqual([
      { tenant_id: B, status: "none" },
      { tenant_id: A, status: "none" },
    ]);
  });
  it("audit lỗi ⇒ ném (rollback cả ngắt), không phát", async () => {
    const { uc, frames } = setup({
      disconnect: async () => true,
      auditDisconnect: async () => {
        throw new Error("audit");
      },
    });
    await expect(uc.disconnect(who, B)).rejects.toThrow("audit");
    expect(frames).toHaveLength(0);
  });
  it("lỗi Redis chỉ bị nuốt, không làm hỏng thao tác", async () => {
    const uc = connectUsecases({
      uow: {
        tenant: async (_w, fn) =>
          fn({
            connect: {
              block: async () => true,
              owners: async () => [{ tenant_id: A, user_id: U1 }],
            } as never,
            posts: {} as never,
          }),
      },
      selfName: async () => "",
      publish: async () => {
        throw new Error("redis");
      },
    });
    await expect(uc.decline(who, B)).resolves.toBeUndefined();
  });
});

describe("CR-161 · danh sách / bài: xin limit+1, con trỏ từ dòng cuối", () => {
  it("links: còn trang ⇒ next_cursor = (since, tenant_id) dòng cuối; hết ⇒ null", async () => {
    const row = (id: string, since: string) => ({ tenant_id: id, since }) as never;
    const asked: number[] = [];
    const { uc } = setup({
      links: async (_s, _c, limit) => {
        asked.push(limit);
        return [row(B, "2026-11-15T03:00:00.000002Z"), row(A, "2026-11-15T03:00:00.000001Z")];
      },
    });
    const p = await uc.links(who, { cursor: null, limit: 1 });
    expect(asked).toEqual([2]);
    expect(p.items).toHaveLength(1);
    expect(decodeCursor(p.next_cursor as string)).toEqual({
      t: "2026-11-15T03:00:00.000002Z",
      id: B,
    });
    const last = await uc.links(who, { cursor: null, limit: 2 });
    expect(last.next_cursor).toBeNull();
  });
});
