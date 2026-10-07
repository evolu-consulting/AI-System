// HUB-FR-96 · HUB-FR-97 · HUB-FR-98 · AC-H24 · X2a-AC06 · X2a-AC13 · tạo/mở phòng, danh sách, ẩn DM (test-plan X2a §5.2
// O01–O14, O30–O34; plan §3, D7, D8). Phòng tạo qua API trong từng `it`. 400 = `VALIDATION_ERROR` (D1).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  api,
  type Ctx,
  codeOf,
  e400,
  eUser,
  listItem,
  mkDm,
  mkGroup,
  P,
  qIds,
  say,
  startX2a,
  UNKNOWN_ROOM,
} from "./_x2a";

let c: Ctx & { stop: () => Promise<void> };
beforeAll(async () => {
  c = await startX2a();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const roomCount = async (): Promise<number> => {
  const [r] = await c.sql`select count(*)::int as n from hub.rooms`;
  return r?.n ?? -1;
};
const memberCount = async (): Promise<number> => {
  const [r] = await c.sql`select count(*)::int as n from hub.room_members`;
  return r?.n ?? -1;
};

describe("O01–O06 · DM [X2a-R05 · R06 · AC-H24]", () => {
  it("HUB-FR-97 · O01–O03 · A mở DM B ⇒ 201; lần 2 ⇒ 200 cùng id; B mở DM A ⇒ 200 cùng id; DM với chính mình ⇒ 400 DM_SELF [X2a-R05 · AC-H24]", async () => {
    const a = await c.tok("lan");
    const first = await api(c.hub, a, "POST", "/rooms", { kind: "dm", user_id: P.tam.id });
    expect(first.status).toBe(201);
    expect(first.json).toMatchObject({ kind: "dm", name: null, my_role: null, member_count: 2 });
    expect(first.json.peer).toMatchObject({ id: P.tam.id, username: "tam" });
    const again = await api(c.hub, a, "POST", "/rooms", { kind: "dm", user_id: P.tam.id });
    expect({ s: again.status, id: again.json?.id }).toEqual({ s: 200, id: first.json.id });
    const rev = await api(c.hub, await c.tok("tam"), "POST", "/rooms", {
      kind: "dm",
      user_id: P.lan.id,
    });
    expect({ s: rev.status, id: rev.json?.id }).toEqual({ s: 200, id: first.json.id });
    expect(
      codeOf(await api(c.hub, a, "POST", "/rooms", { kind: "dm", user_id: P.lan.id })),
    ).toEqual({
      status: 400,
      code: "DM_SELF",
    });
  });

  it("HUB-FR-97 · O04 · DM với an/khoa/nghi/UNKNOWN ⇒ 404 USER_NOT_FOUND details.user_ids=[id], 0 phòng [X2a-R01 · R02]", async () => {
    const a = await c.tok("lan");
    await mkGroup(c.hub, a, [], "Mồi O04");
    const before = await roomCount();
    for (const peer of [P.an.id, P.khoa.id, P.nghi.id, UNKNOWN_ROOM]) {
      const r = await api(c.hub, a, "POST", "/rooms", { kind: "dm", user_id: peer });
      expect({ peer, r: codeOf(r), d: r.json?.error?.details }).toEqual({
        peer,
        r: eUser,
        d: { user_ids: [peer] },
      });
    }
    expect(await roomCount()).toBe(before);
  });

  it("HUB-FR-97 · O05 · DM: PATCH/DELETE/thêm/bớt/rời/chuyển ⇒ 409 DM_IMMUTABLE, DB không đổi [X2a-R06 · AC-H24]", async () => {
    const a = await c.tok("lan");
    const dm = await mkDm(c.hub, a, P.hoa.id);
    const before = JSON.stringify(
      await c.sql`select * from hub.room_members where room_id = ${dm.id} order by user_id`,
    );
    const calls = [
      ["PATCH", `/rooms/${dm.id}`, { name: "Đổi" }],
      ["DELETE", `/rooms/${dm.id}`, undefined],
      ["POST", `/rooms/${dm.id}/members`, { user_ids: [P.tam.id] }],
      ["DELETE", `/rooms/${dm.id}/members/${P.hoa.id}`, undefined],
      ["POST", `/rooms/${dm.id}/leave`, undefined],
      ["POST", `/rooms/${dm.id}/transfer`, { user_id: P.hoa.id }],
    ] as const;
    for (const [m, p, b] of calls)
      expect({ m, p, r: codeOf(await api(c.hub, a, m, p, b)) }).toEqual({
        m,
        p,
        r: { status: 409, code: "DM_IMMUTABLE" },
      });
    const after = JSON.stringify(
      await c.sql`select * from hub.room_members where room_id = ${dm.id} order by user_id`,
    );
    expect(after).toBe(before);
  });

  it("HUB-FR-97 · O06 · DM chưa có tin: không có trong /rooms của B, có của A; tin đầu ⇒ B thấy [plan D7]", async () => {
    const e = await c.tok("tam");
    const dm = await mkDm(c.hub, e, P.cuc.id);
    expect(await listItem(c.hub, e, dm.id)).toBeDefined();
    const cTok = await c.tok("cuc");
    expect(await listItem(c.hub, cTok, dm.id)).toBeUndefined();
    await say(c.hub, e, dm.id, "Tin đầu O06");
    expect(await listItem(c.hub, cTok, dm.id)).toBeDefined();
  });
});

describe("O10–O14 · tạo nhóm [X2a-R08 · X2a-AC13]", () => {
  it('HUB-FR-98 · O10–O11 · tên "" / "   " / 81 ký tự ⇒ 400 VALIDATION_ERROR; 80 + trim ⇒ 201 [X2a-R08 · X2a-AC13]', async () => {
    const a = await c.tok("lan");
    for (const name of ["", "   ", "a".repeat(81)])
      expect(
        codeOf(await api(c.hub, a, "POST", "/rooms", { kind: "group", name, member_ids: [] })),
      ).toEqual(e400);
    const r = await api(c.hub, a, "POST", "/rooms", {
      kind: "group",
      name: `  ${"b".repeat(80)}  `,
      member_ids: [],
    });
    expect(r.status).toBe(201);
    expect(r.json.name).toBe("b".repeat(80));
  });

  it("HUB-FR-98 · O12 · 49 người khác ⇒ 201 member_count=50, my_role=owner, owner_id=A [X2a-R08 · X2a-AC13]", async () => {
    const r = await api(c.hub, await c.tok("lan"), "POST", "/rooms", {
      kind: "group",
      name: "Nhóm 50",
      member_ids: qIds(1, 49),
    });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({
      kind: "group",
      member_count: 50,
      my_role: "owner",
      owner_id: P.lan.id,
      peer: null,
    });
    expect(r.json.members.length).toBe(50);
  });

  it("HUB-FR-98 · O13 · 50 người khác ⇒ 409 ROOM_FULL {max:50, requested:51}, 0 phòng, 0 thành viên ghi [X2a-R08 · AC-H24 · X2a-AC13]", async () => {
    const a = await c.tok("lan");
    await mkGroup(c.hub, a, [], "Mồi O13");
    const [rooms, members] = [await roomCount(), await memberCount()];
    const r = await api(c.hub, a, "POST", "/rooms", {
      kind: "group",
      name: "Nhóm 51",
      member_ids: qIds(1, 50),
    });
    expect(codeOf(r)).toEqual({ status: 409, code: "ROOM_FULL" });
    expect(r.json.error.details).toEqual({ max: 50, requested: 51 });
    expect([await roomCount(), await memberCount()]).toEqual([rooms, members]);
  });

  it("HUB-FR-98 · O14 · member_ids có an/khoa ⇒ 404 USER_NOT_FOUND, không ghi phần nào; trùng/self ⇒ bỏ qua [X2a-R01 · R02 · R08]", async () => {
    const a = await c.tok("lan");
    await mkGroup(c.hub, a, [], "Mồi O14");
    const before = [await roomCount(), await memberCount()];
    const bad = await api(c.hub, a, "POST", "/rooms", {
      kind: "group",
      name: "Lẫn người ngoài",
      member_ids: [P.hoa.id, P.an.id, P.khoa.id],
    });
    expect(codeOf(bad)).toEqual(eUser);
    expect([...bad.json.error.details.user_ids].sort()).toEqual([P.an.id, P.khoa.id].sort());
    expect([await roomCount(), await memberCount()]).toEqual(before);
    const ok = await mkGroup(c.hub, a, [P.hoa.id, P.hoa.id, P.lan.id], "Trùng");
    expect(ok.member_count).toBe(2);
    expect(
      codeOf(
        await api(c.hub, a, "POST", "/rooms", { kind: "group", name: "X", tenant_id: P.an.tid }),
      ),
    ).toEqual(e400);
  });
});

describe("O30 · GET /rooms [X2a-R17]", () => {
  it("HUB-FR-96 · O30 · sắp last_activity_at giảm; limit=1 + next_cursor đủ trang không lặp; DM có peer, name null; member_count; unread_total [X2a-R17]", async () => {
    const e = await c.tok("tam");
    const g1 = await mkGroup(c.hub, e, [P.cuc.id], "O30 một");
    const dm = await mkDm(c.hub, e, P.hoa.id);
    const g2 = await mkGroup(c.hub, e, [P.cuc.id], "O30 hai");
    await say(c.hub, e, g1.id, "cũ nhất");
    await say(c.hub, e, dm.id, "giữa");
    await say(c.hub, e, g2.id, "mới nhất");
    const full = await api(c.hub, e, "GET", "/rooms?limit=200");
    const ids = (full.json.items as { id: string }[]).map((i) => i.id);
    expect(ids.slice(0, 3)).toEqual([g2.id, dm.id, g1.id]);
    const d = full.json.items.find((i: { id: string }) => i.id === dm.id);
    expect(d).toMatchObject({ kind: "dm", name: null, member_count: 2, my_role: null, unread: 0 });
    expect(d.peer).toMatchObject({ id: P.hoa.id });
    expect(d.last_message).toMatchObject({ seq: 1, preview: "giữa" });
    expect(typeof full.json.unread_total).toBe("number");
    const paged: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const q: string = cursor
        ? `/rooms?limit=1&cursor=${encodeURIComponent(cursor)}`
        : "/rooms?limit=1";
      const r = await api(c.hub, e, "GET", q);
      expect(r.status).toBe(200);
      paged.push(...r.json.items.map((x: { id: string }) => x.id));
      cursor = r.json.next_cursor;
      if (!cursor) break;
    }
    expect(paged).toEqual(ids);
    expect(codeOf(await api(c.hub, e, "GET", "/rooms?cursor=%%%rac"))).toEqual(e400);
  });
});

describe("O31–O34 · ẩn DM [X2a-R07 · X2a-AC06]", () => {
  it("HUB-FR-97 · O31 · A ẩn DM ⇒ 204 (lần 2 ⇒ 204); mất khỏi /rooms A, B vẫn thấy [X2a-R07 · X2a-AC06]", async () => {
    const a = await c.tok("lan");
    const b = await c.tok("hoa");
    const dm = await mkDm(c.hub, a, P.hoa.id);
    await say(c.hub, a, dm.id, "O31");
    expect((await api(c.hub, a, "POST", `/rooms/${dm.id}/hide`)).status).toBe(204);
    expect((await api(c.hub, a, "POST", `/rooms/${dm.id}/hide`)).status).toBe(204);
    expect(await listItem(c.hub, a, dm.id)).toBeUndefined();
    expect(await listItem(c.hub, b, dm.id)).toBeDefined();
  });

  it("HUB-FR-97 · O32 · ẩn nhóm ⇒ 409 GROUP_NOT_HIDEABLE [X2a-R06]", async () => {
    const a = await c.tok("lan");
    const g = await mkGroup(c.hub, a, [P.hoa.id]);
    expect(codeOf(await api(c.hub, a, "POST", `/rooms/${g.id}/hide`))).toEqual({
      status: 409,
      code: "GROUP_NOT_HIDEABLE",
    });
    expect(codeOf(await api(c.hub, await c.tok("hoa"), "POST", `/rooms/${g.id}/hide`))).toEqual({
      status: 409,
      code: "GROUP_NOT_HIDEABLE",
    });
  });

  it("HUB-FR-100 · O33 · B gửi tin ⇒ DM hiện lại ở A + unread=1; unread_total tính lại (không gồm DM lúc ẩn) [X2a-R07 · R17 · X2a-AC06]", async () => {
    const a = await c.tok("tam");
    const b = await c.tok("cuc");
    const dm = await mkDm(c.hub, a, P.cuc.id);
    await say(c.hub, b, dm.id, "trước khi ẩn");
    const t0 = (await api(c.hub, a, "GET", "/rooms")).json.unread_total;
    const u0 = (await listItem(c.hub, a, dm.id))?.unread;
    expect(u0).toBeGreaterThan(0);
    expect((await api(c.hub, a, "POST", `/rooms/${dm.id}/hide`)).status).toBe(204);
    const t1 = (await api(c.hub, a, "GET", "/rooms")).json.unread_total;
    expect(t1).toBe(t0 - u0);
    expect((await api(c.hub, a, "POST", `/rooms/${dm.id}/read`, { seq: 999 })).status).toBe(200);
    await say(c.hub, b, dm.id, "hiện lại");
    const it = await listItem(c.hub, a, dm.id);
    expect(it).toMatchObject({ unread: 1 });
    const t2 = (await api(c.hub, a, "GET", "/rooms")).json.unread_total;
    expect(t2).toBe(t1 + 1);
  });

  it("HUB-FR-97 · O34 · A mở lại DM qua POST /rooms ⇒ 200 cùng id, hết ẩn [X2a-R07]", async () => {
    const a = await c.tok("lan");
    const dm = await mkDm(c.hub, a, P.tam.id);
    await say(c.hub, a, dm.id, "O34");
    expect((await api(c.hub, a, "POST", `/rooms/${dm.id}/hide`)).status).toBe(204);
    const r = await api(c.hub, a, "POST", "/rooms", { kind: "dm", user_id: P.tam.id });
    expect({ s: r.status, id: r.json?.id }).toEqual({ s: 200, id: dm.id });
    expect(await listItem(c.hub, a, dm.id)).toBeDefined();
  });
});
