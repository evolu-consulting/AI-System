// CR-132 M3 · HD-MSG-01..12 · API tin nhắn ở tầng use case trên DB thật (role gói `contracts_rw` + RLS 0107, tra người dùng qua kit):
// đường chính mỗi endpoint (tạo 1-1 lặp ⇒ cùng id · nhóm · gửi + idempotent · danh sách + chưa đọc · đọc · thu hồi · đổi tên · thêm/bớt · chủ rời ⇒ chuyển chủ ·
// người cuối rời ⇒ xoá) và một ca người NGOÀI hội thoại / công ty khác ⇒ cùng 404 `MSG_NOT_FOUND` ở mọi thao tác.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../../lib/db";
import { internalDirectory, internalUsersAmong } from "../../kit/adapters/member-names";
import { createPackUow } from "../../kit/adapters/pack-uow";
import type { PackUow } from "../../kit/public";
import { messagesRepo } from "./adapters/messages.repo";
import type { MessagesRepos } from "./application/messages.ports";
import { type MsgFail, messagesUsecases } from "./application/messages.usecase";

let o: Sql;
let db: Db;
let T = "";
let T2 = "";
let U1 = "";
let U2 = "";
let U3 = "";
let U4 = ""; // bị khoá
let U5 = ""; // ngoài mọi hội thoại
let V1 = ""; // công ty khác

const uow = () =>
  createPackUow(db, "contracts", (tx, t) => ({
    messages: messagesRepo(tx, t),
  })) as never as PackUow<MessagesRepos>;
const uc = () =>
  messagesUsecases({ uow: uow(), people: internalUsersAmong(db), newId: () => Bun.randomUUIDv7() });
const w = (userId: string, tenantId = T) => ({ tenantId, userId });
const code = async (p: Promise<unknown>) => ((await p.catch((x: unknown) => x)) as MsgFail).code;
const cid = () => Bun.randomUUIDv7();
const send = (who: string, conv: string, body: string) =>
  uc().send(w(who), conv, { client_id: cid(), body, file_ids: [] });

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  [T, T2] = (await tenants(o, 2, 9361)) as [string, string];
  [U1, U2, U3, U4, U5] = (await users(o, T, 5, { from: 9361 })) as [
    string,
    string,
    string,
    string,
    string,
  ];
  [V1] = (await users(o, T2, 1, { from: 9370 })) as [string];
  await o`update admin.users set active = false where id = ${U4}`;
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

let dmId = "";
let gId = "";

describe("CR-132 M3 · hội thoại: tạo, danh sách, chi tiết", () => {
  it("1-1: tạo; phía kia mở lại ⇒ cùng id (200); tự nhắn / người bị khoá / công ty khác ⇒ lỗi mã", async () => {
    const a = await uc().create(w(U1), { kind: "direct", user_id: U2 });
    expect(a.created).toBe(true);
    expect(a.detail.kind).toBe("direct");
    expect(a.detail.peer?.id).toBe(U2);
    expect(a.detail.members.map((m) => m.role)).toEqual(["member", "member"]);
    const b = await uc().create(w(U2), { kind: "direct", user_id: U1 });
    expect(b.created).toBe(false);
    expect(b.detail.id).toBe(a.detail.id);
    expect(b.detail.peer?.id).toBe(U1);
    dmId = a.detail.id;
    expect(await code(uc().create(w(U1), { kind: "direct", user_id: U1 }))).toBe("MSG_DM_SELF");
    expect(await code(uc().create(w(U1), { kind: "direct", user_id: U4 }))).toBe(
      "MSG_USER_INVALID",
    );
    expect(await code(uc().create(w(U1), { kind: "direct", user_id: V1 }))).toBe(
      "MSG_USER_INVALID",
    );
  });

  it("nhóm: người tạo là chủ, người được thêm là thành viên; thành viên không hợp lệ ⇒ 422", async () => {
    const g = await uc().create(w(U1), { kind: "group", title: "Mua hàng", member_ids: [U2, U3] });
    expect(g.created).toBe(true);
    gId = g.detail.id;
    expect(g.detail.my_role).toBe("owner");
    expect(g.detail.member_count).toBe(3);
    expect(g.detail.peer).toBeNull();
    expect(g.detail.members.find((m) => m.user_id === U2)?.role).toBe("member");
    for (const bad of [U4, U1, V1])
      expect(await code(uc().create(w(U1), { kind: "group", title: "x", member_ids: [bad] }))).toBe(
        "MSG_USER_INVALID",
      );
  });

  it("gửi tin: tăng seq, trùng client_id ⇒ bản cũ (không tăng seq); tin rỗng ⇒ MSG_EMPTY; chưa đọc + tin cuối trong danh sách", async () => {
    const client = cid();
    const req = { client_id: client, body: "xin chào cả nhóm", file_ids: [] };
    const s1 = await uc().send(w(U1), gId, req);
    expect(s1.created).toBe(true);
    expect(s1.message.seq).toBe(1);
    expect(s1.memberIds.sort()).toEqual([U1, U2, U3].sort());
    const again = await uc().send(w(U1), gId, req);
    expect(again.created).toBe(false);
    expect(again.message.id).toBe(s1.message.id);
    expect((await send(U1, gId, "tin hai")).message.seq).toBe(2);
    expect(await code(send(U1, gId, ""))).toBe("MSG_EMPTY");

    const list = await uc().list(w(U2), { cursor: null, limit: 30 });
    const row = list.items.find((x) => x.id === gId);
    expect(list.items[0]?.id).toBe(gId); // mới nhất lên đầu
    expect(row?.unread).toBe(2);
    expect(row?.last_message?.preview).toBe("tin hai");
    expect(row?.last_message?.sender_name).not.toBe("");
    expect(list.items.find((x) => x.id === dmId)?.peer?.id).toBe(U1);
    const mine = await uc().list(w(U1), { cursor: null, limit: 30 });
    expect(mine.items.find((x) => x.id === gId)?.unread).toBe(0); // tin của chính mình
    expect((await uc().unread(w(U2))).total).toBe(2);
    expect((await uc().unread(w(U1))).total).toBe(0);
  });

  it("danh sách tin theo seq (tăng dần, phân trang before_seq); đọc ⇒ chưa đọc về 0, mốc không lùi / không vượt tin cuối", async () => {
    const all = await uc().messages(w(U2), gId, { limit: 50 });
    expect(all.items.map((m) => m.seq)).toEqual([1, 2]);
    expect(all.has_more).toBe(false);
    const p1 = await uc().messages(w(U2), gId, { limit: 1 });
    expect(p1.items.map((m) => m.seq)).toEqual([2]);
    expect(p1.has_more).toBe(true);
    const p2 = await uc().messages(w(U2), gId, { before_seq: 2, limit: 1 });
    expect(p2.items.map((m) => m.seq)).toEqual([1]);
    expect(p2.has_more).toBe(false);

    expect((await uc().markRead(w(U2), gId, 1)).unread_total).toBe(1);
    expect((await uc().markRead(w(U2), gId, 999)).unread_total).toBe(0);
    expect((await uc().markRead(w(U2), gId, 0)).unread_total).toBe(0); // không lùi
    const d = await uc().get(w(U1), gId);
    expect(d.members.find((m) => m.user_id === U2)?.last_read_seq).toBe(2); // kẹp theo tin cuối
  });

  it("1-1 với người vừa bị khoá: gửi ⇒ MSG_PEER_INACTIVE, vẫn mở lại được lịch sử", async () => {
    const dm = await uc().create(w(U1), { kind: "direct", user_id: U3 });
    await o`update admin.users set active = false where id = ${U3}`;
    try {
      expect(await code(send(U1, dm.detail.id, "alo"))).toBe("MSG_PEER_INACTIVE");
      const re = await uc().create(w(U1), { kind: "direct", user_id: U3 });
      expect(re.created).toBe(false);
      expect(re.detail.peer?.active).toBe(false);
    } finally {
      await o`update admin.users set active = true where id = ${U3}`;
    }
  });
});

describe("CR-132 M3 · thu hồi, đổi tên, thành viên", () => {
  it("thu hồi: người khác ⇒ MSG_NOT_SENDER; chính chủ ⇒ tin rỗng + deleted, lặp lại vô hại, chưa đọc không tính tin đã thu hồi", async () => {
    const s = await send(U1, gId, "gửi nhầm");
    expect(await code(uc().revoke(w(U2), gId, s.message.seq))).toBe("MSG_NOT_SENDER");
    expect((await uc().unread(w(U2))).total).toBe(1);
    await uc().revoke(w(U1), gId, s.message.seq);
    await uc().revoke(w(U1), gId, s.message.seq);
    const page = await uc().messages(w(U2), gId, { limit: 1 });
    expect(page.items[0]).toMatchObject({ seq: s.message.seq, body: "", deleted: true, files: [] });
    expect((await uc().unread(w(U2))).total).toBe(0);
    expect(await code(uc().revoke(w(U1), gId, 999))).toBe("MSG_NOT_FOUND");
  });

  it("đổi tên / thêm người: chỉ chủ nhóm; 1-1 cố định; người bị khoá không thêm được; người đã trong nhóm bỏ qua", async () => {
    expect(await code(uc().rename(w(U2), gId, "Tên mới"))).toBe("MSG_NOT_OWNER");
    expect(await code(uc().rename(w(U1), dmId, "Tên"))).toBe("MSG_DIRECT_FIXED");
    expect((await uc().rename(w(U1), gId, "Mua hàng Q4")).title).toBe("Mua hàng Q4");
    expect(await code(uc().addMembers(w(U2), gId, [U5]))).toBe("MSG_NOT_OWNER");
    expect(await code(uc().addMembers(w(U1), gId, [U4]))).toBe("MSG_USER_INVALID");
    expect(await code(uc().addMembers(w(U1), dmId, [U5]))).toBe("MSG_DIRECT_FIXED");
    const d = await uc().addMembers(w(U1), gId, [U5, U2]);
    expect(d.member_count).toBe(4);
    expect(d.members.find((m) => m.user_id === U5)?.last_read_seq).toBe(3); // vào sau: không đỏ cả lịch sử cũ
    expect((await uc().unread(w(U5))).total).toBe(0);
  });

  it("bớt người: thành viên thường không bớt người khác; chủ rời ⇒ người vào sớm nhất thành chủ; người cuối rời ⇒ hội thoại bị xoá", async () => {
    expect(await code(uc().removeMember(w(U2), gId, U3))).toBe("MSG_NOT_OWNER");
    expect(await code(uc().removeMember(w(U1), dmId, U2))).toBe("MSG_DIRECT_FIXED");
    await uc().removeMember(w(U1), gId, U5); // chủ bớt người
    await uc().removeMember(w(U1), gId, U1); // chủ rời
    const d = await uc().get(w(U2), gId);
    expect(d.members.map((m) => m.user_id).sort()).toEqual([U2, U3].sort());
    expect(d.members.filter((m) => m.role === "owner")).toHaveLength(1);
    expect(await code(uc().get(w(U1), gId))).toBe("MSG_NOT_FOUND"); // người đã rời mất quyền xem
    await uc().removeMember(w(U2), gId, U2);
    await uc().removeMember(w(U3), gId, U3);
    const left =
      await o`select count(*)::int as n from contracts.msg_conversations where id = ${gId}`;
    expect(left[0]?.n).toBe(0);
    const msgs =
      await o`select count(*)::int as n from contracts.msg_messages where conversation_id = ${gId}`;
    expect(msgs[0]?.n).toBe(0);
  });
});

describe("CR-132 M3 · người NGOÀI hội thoại / công ty khác", () => {
  it("mọi thao tác trên hội thoại của người khác ⇒ cùng MSG_NOT_FOUND; danh sách không lộ; không chen được tin", async () => {
    const x = await uc().create(w(U1), { kind: "group", title: "Riêng tư", member_ids: [U2] });
    const id = x.detail.id;
    const sent = await send(U1, id, "mật");
    for (const who of [w(U5), w(V1, T2)]) {
      const calls: Promise<unknown>[] = [
        uc().get(who, id),
        uc().messages(who, id, { limit: 50 }),
        uc().send(who, id, { client_id: cid(), body: "chen", file_ids: [] }),
        uc().revoke(who, id, sent.message.seq),
        uc().markRead(who, id, 1),
        uc().rename(who, id, "x"),
        uc().addMembers(who, id, [U5]),
        uc().removeMember(who, id, U2),
      ];
      expect(await Promise.all(calls.map(code))).toEqual(Array(calls.length).fill("MSG_NOT_FOUND"));
      const list = await uc().list(who, { cursor: null, limit: 30 });
      expect(list.items.find((i) => i.id === id)).toBeUndefined();
    }
    const mine = await o`select seq from contracts.msg_messages where conversation_id = ${id}`;
    expect(mine).toHaveLength(1);
  });
});

describe("CR-132b · danh bạ «Thành viên»", () => {
  it("đường chính: đồng nghiệp còn dùng được, trừ mình và người bị khoá", async () => {
    const list = await internalDirectory(db)({ ...w(U1), userKind: "internal" });
    const ids = list.map((x) => x.id).sort();
    expect(ids).toEqual([U2, U3, U5].sort());
  });
  it("chặn chéo công ty và đối tác: không lộ người công ty khác; external ⇒ rỗng", async () => {
    const other = await internalDirectory(db)({ ...w(V1, T2), userKind: "internal" });
    expect(other.map((x) => x.id)).not.toContain(U2);
    expect(other.map((x) => x.id)).not.toContain(V1);
    const ext = await internalDirectory(db)({ ...w(U1), userKind: "external" });
    expect(ext).toEqual([]);
  });
});
