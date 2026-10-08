// HUB-FR-100 · HUB-FR-101 · CR-050: khối agent gốc mang `flow.recent` (≤ 3 tin `flow` mới nhất) + `flow.unread` theo người
// xem; `POST /rooms/:id/flows/:flow_id/read` (mốc chỉ tăng, kẹp ≤ seq thread); gửi trong thread ⇒ tự đọc tới tin mình;
// RLS `room_flow_reads`: chỉ hàng của mình, ghi chỉ khi thread thuộc phòng mình là thành viên.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { api, asUser, codeOf, e404, mkGroup, pgCode, UNKNOWN_ROOM } from "../X2a/_x2a";
import {
  agentMsgs,
  answer,
  type CtxB,
  invoke,
  type Json,
  P,
  post,
  settle,
  startX2b,
  timeline,
  type Who,
  waitAgentMsg,
} from "../X2b/_x2b";

let c: CtxB;
beforeAll(async () => {
  c = await startX2b();
}, 60_000);
afterEach(() => settle(c.sql));
afterAll(() => c?.stop());

/** Nhóm A (`lan`, chủ) + B (`hoa`) + C (`cuc`); A mở thread T bằng @hoadon, agent trả lời ở timeline. */
async function thread(name: string) {
  const room = (await mkGroup(c.hub, await c.tok("lan"), [P.hoa.id, P.cuc.id], name)).id as string;
  const s = await invoke(c, "lan", room, "@hoadon kiểm tra HD-12");
  await answer(c, s.runId, "HD-12 hợp lệ.");
  expect(await waitAgentMsg(c, "lan", room, s.runId)).toBeDefined();
  return { room, T: s.flowId as string };
}

/** Tóm tắt thread trên khối agent gốc theo người xem. */
async function flowOf(who: Who, room: string): Promise<Json> {
  const [root] = agentMsgs(await timeline(c, who, room));
  return root?.flow as Json;
}

const read = async (who: Who, room: string, T: string, body: unknown) =>
  api(c.hub, await c.tok(who), "POST", `/rooms/${room}/flows/${T}/read`, body);

describe("CR-050 · flow.recent + flow.unread", () => {
  it("HUB-FR-101 · CR-050 · B gửi 2, C gửi 2 ⇒ recent = 3 tin mới nhất (seq tăng); A chưa xem 4; B chưa xem 2 (tin mình không tính)", async () => {
    const { room, T } = await thread("CR050 recent");
    for (const [who, text] of [
      ["hoa", "B-1"],
      ["hoa", "B-2"],
      ["cuc", "C-1"],
      ["cuc", "C-2"],
    ] as const)
      expect((await post(c, who, room, { content: text, flow_id: T })).res.status).toBe(201);

    const a = await flowOf("lan", room);
    expect(a.message_count).toBe(4);
    expect(a.unread).toBe(4);
    const recent = a.recent as Json[];
    expect(recent.map((r) => r.preview)).toEqual(["B-2", "C-1", "C-2"]);
    expect(recent.map((r) => r.seq as number)).toEqual(
      [...recent.map((r) => r.seq as number)].sort((x, y) => x - y),
    );
    expect(recent.every((r) => r.unread === true)).toBe(true);
    expect(((recent[0] as Json).sender as Json).display_name).toBe(P.hoa.username);

    const b = await flowOf("hoa", room);
    expect(b.unread).toBe(2);
    expect((b.recent as Json[]).map((r) => r.unread)).toEqual([false, true, true]);
  });

  it("HUB-FR-100 · CR-050 · A đọc thread (seq rất lớn ⇒ kẹp) ⇒ unread 0, recent hết highlight; B gửi tiếp ⇒ A chưa xem 1", async () => {
    const { room, T } = await thread("CR050 read");
    await post(c, "hoa", room, { content: "B-1", flow_id: T });
    const r = await read("lan", room, T, { seq: 9_999_999 });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ unread: 0 });
    const [row] = await c.sql<{ last_read_seq: string; max: string }[]>`
      select fr.last_read_seq, (select max(seq) from hub.room_messages where room_id = ${room} and flow_id = ${T}) as max
      from hub.room_flow_reads fr where fr.room_id = ${room} and fr.flow_id = ${T} and fr.user_id = ${P.lan.id}`;
    expect(Number(row?.last_read_seq)).toBe(Number(row?.max));

    const a = await flowOf("lan", room);
    expect(a.unread).toBe(0);
    expect((a.recent as Json[]).every((x) => x.unread === false)).toBe(true);

    await post(c, "hoa", room, { content: "B-2", flow_id: T });
    expect((await flowOf("lan", room)).unread).toBe(1);
    // Mốc chỉ tăng: gửi seq nhỏ hơn không lùi.
    expect((await read("lan", room, T, { seq: 0 })).json).toEqual({ unread: 1 });
  });

  it("HUB-FR-100 · CR-050 · 404 thread lạ / flow_id không uuid / không phải thành viên; 400 body sai", async () => {
    const { room, T } = await thread("CR050 errors");
    expect(codeOf(await read("lan", room, UNKNOWN_ROOM, { seq: 1 }))).toEqual({
      status: 404,
      code: "NOT_FOUND",
    });
    expect(codeOf(await read("lan", room, "abc", { seq: 1 }))).toEqual({
      status: 404,
      code: "NOT_FOUND",
    });
    const other = (await mkGroup(c.hub, await c.tok("lan"), [], "CR050 khác")).id as string;
    expect(codeOf(await read("lan", other, T, { seq: 1 }))).toEqual({
      status: 404,
      code: "NOT_FOUND",
    });
    expect(codeOf(await read("tam", room, T, { seq: 1 }))).toEqual(e404);
    expect((await read("lan", room, T, { seq: -1 })).status).toBe(400);
  });
});

describe("CR-050 · người vào phòng sau", () => {
  it("HUB-FR-100 · CR-050 · E được thêm sau khi thread có comment ⇒ comment cũ không tính chưa xem; comment mới thì có", async () => {
    const { room, T } = await thread("CR050 join sau");
    await post(c, "hoa", room, { content: "TRUOC-KHI-E-VAO", flow_id: T });
    const add = await api(c.hub, await c.tok("lan"), "POST", `/rooms/${room}/members`, {
      user_ids: [P.tam.id],
    });
    expect(add.status).toBe(200);
    const before = await flowOf("tam", room);
    expect(before.unread).toBe(0);
    expect((before.recent as Json[]).every((r) => r.unread === false)).toBe(true);
    await post(c, "hoa", room, { content: "SAU-KHI-E-VAO", flow_id: T });
    expect((await flowOf("tam", room)).unread).toBe(1);
  });
});

describe("CR-050 · RLS room_flow_reads", () => {
  it("HUB-FR-100 · CR-050 · B không thấy/sửa hàng của A, không ghi hàng đứng tên A, không ghi thread ngoài phòng", async () => {
    const { room, T } = await thread("CR050 rls");
    await read("lan", room, T, { seq: 1 });
    const seen = await asUser(c.sql, P.hoa, (tx) =>
      tx`select user_id from hub.room_flow_reads where room_id = ${room}`.then((r) => r.length),
    );
    expect(seen).toBe(0);
    const upd = await asUser(c.sql, P.hoa, (tx) =>
      tx`update hub.room_flow_reads set last_read_seq = 0 where user_id = ${P.lan.id} returning 1`.then(
        (r) => r.length,
      ),
    );
    expect(upd).toBe(0);
    const forge = asUser(
      c.sql,
      P.hoa,
      (
        tx,
      ) => tx`insert into hub.room_flow_reads (room_id, tenant_id, flow_id, user_id, last_read_seq)
        values (${room}, ${P.hoa.tid}, ${T}, ${P.lan.id}, 1)`,
    );
    expect(await pgCode(forge)).toBe("42501");
    const other = (await mkGroup(c.hub, await c.tok("hoa"), [], "CR050 rls khác")).id as string;
    const foreign = asUser(
      c.sql,
      P.hoa,
      (
        tx,
      ) => tx`insert into hub.room_flow_reads (room_id, tenant_id, flow_id, user_id, last_read_seq)
        values (${other}, ${P.hoa.tid}, ${T}, ${P.hoa.id}, 1)`,
    );
    expect(await pgCode(foreign)).toBe("42501");
    const del = asUser(
      c.sql,
      P.lan,
      (tx) => tx`delete from hub.room_flow_reads where room_id = ${room}`,
    );
    expect(await pgCode(del)).toBe("42501");
  });

  it("HUB-FR-100 · CR-050 · tenant khác không ghi được; sửa cột ngoài last_read_seq bị chặn; rời phòng thì không ghi/đọc nữa", async () => {
    const { room, T } = await thread("CR050 rls 2");
    const other = asUser(
      c.sql,
      P.an,
      (
        tx,
      ) => tx`insert into hub.room_flow_reads (room_id, tenant_id, flow_id, user_id, last_read_seq)
        values (${room}, ${P.an.tid}, ${T}, ${P.an.id}, 1)`,
    );
    expect(await pgCode(other)).toBe("42501");
    await read("hoa", room, T, { seq: 1 });
    const move = asUser(
      c.sql,
      P.hoa,
      (tx) => tx`update hub.room_flow_reads set user_id = ${P.lan.id} where room_id = ${room}`,
    );
    expect(await pgCode(move)).toBe("42501");
    const left = await api(c.hub, await c.tok("hoa"), "POST", `/rooms/${room}/leave`);
    expect(left.status).toBe(204);
    expect(codeOf(await read("hoa", room, T, { seq: 1 }))).toEqual(e404);
    const seen = await asUser(c.sql, P.hoa, (tx) =>
      tx`select 1 from hub.room_flow_reads where room_id = ${room}`.then((r) => r.length),
    );
    expect(seen).toBe(0);
    const write = await asUser(c.sql, P.hoa, (tx) =>
      tx`update hub.room_flow_reads set last_read_seq = 99 where room_id = ${room} returning 1`.then(
        (r) => r.length,
      ),
    );
    expect(write).toBe(0);
  });
});
