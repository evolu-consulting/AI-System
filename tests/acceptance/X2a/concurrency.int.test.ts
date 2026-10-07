// HUB-FR-96 · HUB-FR-97 · HUB-FR-98 · X2a-AC07 · tranh chấp (test-plan X2a §5.3 P01–P07; plan-db §6). Đếm deadlock bằng
// `pgDeadlocks` H1 trước/sau. Phòng tạo qua API trong từng `it`; song song bằng `Promise.all`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { pgDeadlocks } from "../H1/_hub";
import { api, type Ctx, cm, codeOf, mkDm, mkGroup, P, Q, qIds, say, sign, startX2a } from "./_x2a";

let c: Ctx & { stop: () => Promise<void> };
beforeAll(async () => {
  c = await startX2a();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const full = { status: 409, code: "ROOM_FULL" };

describe("P01–P07 · đồng thời [X2a-AC07 · plan-db §6]", () => {
  it("HUB-FR-97 · P01 · 10 vòng A→X và X→A mở DM cùng lúc ⇒ cùng id, status {201, 200}; đúng 1 phòng/cặp [X2a-R05]", async () => {
    const a = await c.tok("lan");
    for (let i = 0; i < 10; i++) {
      const q = Q[i] as (typeof Q)[number];
      const qt = await sign(c.k, q);
      const [r1, r2] = await Promise.all([
        api(c.hub, a, "POST", "/rooms", { kind: "dm", user_id: q.id }),
        api(c.hub, qt, "POST", "/rooms", { kind: "dm", user_id: P.lan.id }),
      ]);
      expect({ i, st: [r1.status, r2.status].sort(), same: r1.json?.id === r2.json?.id }).toEqual({
        i,
        st: [200, 201],
        same: true,
      });
      const [n] =
        await c.sql`select count(*)::int as n from hub.rooms r join hub.room_members m on m.room_id = r.id
        where r.kind = 'dm' and m.user_id = ${q.id}`;
      expect(n?.n).toBe(1);
    }
  });

  it("HUB-FR-98 · P02 · phòng chỉ có chủ; 51 POST /members song song (mỗi lệnh 1 người) ⇒ 49 × 200 + 2 × ROOM_FULL; member_count=50 [X2a-R08]", async () => {
    const a = await c.tok("lan");
    const g = await mkGroup(c.hub, a, [], "P02");
    const res = await Promise.all(
      qIds(1, 51).map((u) => api(c.hub, a, "POST", `/rooms/${g.id}/members`, { user_ids: [u] })),
    );
    const ok = res.filter((r) => r.status === 200).length;
    const rej = res.filter((r) => JSON.stringify(codeOf(r)) === JSON.stringify(full)).length;
    expect({ ok, rej }).toEqual({ ok: 49, rej: 2 });
    expect((await api(c.hub, a, "GET", `/rooms/${g.id}`)).json.member_count).toBe(50);
    const g48 = await mkGroup(c.hub, a, qIds(1, 47), "P02 48");
    const two = await Promise.all([
      api(c.hub, a, "POST", `/rooms/${g48.id}/members`, { user_ids: qIds(48, 2) }),
      api(c.hub, a, "POST", `/rooms/${g48.id}/members`, { user_ids: qIds(50, 2) }),
    ]);
    expect(two.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await api(c.hub, a, "GET", `/rooms/${g48.id}`)).json.member_count).toBe(50);
  });

  it("HUB-FR-96 · P03 · 30 tin song song từ A, B, E ⇒ seq = {1…30} liền, không trùng; last_seq=30; không 5xx [X2a-R15 · X2a-AC07]", async () => {
    const toks = [await c.tok("lan"), await c.tok("hoa"), await c.tok("tam")];
    const g = await mkGroup(c.hub, toks[0] as string, [P.hoa.id, P.tam.id], "P03");
    const res = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        api(c.hub, toks[i % 3] as string, "POST", `/rooms/${g.id}/messages`, {
          content: `P03-${i}`,
          client_msg_id: cm(),
        }),
      ),
    );
    expect(res.map((r) => r.status).filter((s) => s !== 201)).toEqual([]);
    const s = res.map((r) => r.json.seq as number).sort((x, y) => x - y);
    expect(s).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    const [row] = await c.sql`select last_seq::int as n from hub.rooms where id = ${g.id}`;
    expect(row?.n).toBe(30);
  });

  it("HUB-FR-96 · P04 · 5 lệnh cùng client_msg_id song song ⇒ 1 hàng; 1 × 201 + 4 × 200 cùng id [X2a-R15 · X2a-AC07]", async () => {
    const a = await c.tok("lan");
    const g = await mkGroup(c.hub, a, [P.hoa.id], "P04");
    const body = { content: "Trùng P04", client_msg_id: cm() };
    const res = await Promise.all(
      Array.from({ length: 5 }, () => api(c.hub, a, "POST", `/rooms/${g.id}/messages`, body)),
    );
    expect(res.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(res.map((r) => r.json?.id)).size).toBe(1);
    const [n] =
      await c.sql`select count(*)::int as n from hub.room_messages where room_id = ${g.id}`;
    expect(n?.n).toBe(1);
  });

  it("HUB-FR-100 · P05 · 60 thao tác xen kẽ gửi (A, B) + read (B, E) + ẩn/hiện DM ⇒ mọi trả lời 2xx; deadlock +0 [plan-db §6]", async () => {
    const [a, b, e] = [await c.tok("lan"), await c.tok("hoa"), await c.tok("tam")];
    const g = await mkGroup(c.hub, a, [P.hoa.id, P.tam.id], "P05");
    const dm = await mkDm(c.hub, a, P.hoa.id);
    await say(c.hub, a, g.id, "mồi");
    const d0 = await pgDeadlocks(c.sql);
    const ops = Array.from({ length: 60 }, (_, i) => {
      switch (i % 6) {
        case 0:
          return api(c.hub, a, "POST", `/rooms/${g.id}/messages`, {
            content: `P05-a-${i}`,
            client_msg_id: cm(),
          });
        case 1:
          return api(c.hub, b, "POST", `/rooms/${g.id}/messages`, {
            content: `P05-b-${i}`,
            client_msg_id: cm(),
          });
        case 2:
          return api(c.hub, b, "POST", `/rooms/${g.id}/read`, { seq: i });
        case 3:
          return api(c.hub, e, "POST", `/rooms/${g.id}/read`, { seq: 999 });
        case 4:
          return api(c.hub, a, "POST", `/rooms/${dm.id}/hide`);
        default:
          return api(c.hub, b, "POST", `/rooms/${dm.id}/messages`, {
            content: `P05-dm-${i}`,
            client_msg_id: cm(),
          });
      }
    });
    const res = await Promise.all(ops);
    expect(res.map((r) => r.status).filter((s) => s < 200 || s >= 300)).toEqual([]);
    expect(await pgDeadlocks(c.sql)).toBe(d0);
  });

  it("HUB-FR-98 · P06 · chuyển chủ A→B song song B rời + E rời ⇒ không 5xx; đúng 1 owner đang hoạt động [X2a-R11]", async () => {
    const [a, b, e] = [await c.tok("lan"), await c.tok("hoa"), await c.tok("tam")];
    const g = await mkGroup(c.hub, a, [P.hoa.id, P.tam.id], "P06");
    const res = await Promise.all([
      api(c.hub, a, "POST", `/rooms/${g.id}/transfer`, { user_id: P.hoa.id }),
      api(c.hub, b, "POST", `/rooms/${g.id}/leave`),
      api(c.hub, e, "POST", `/rooms/${g.id}/leave`),
    ]);
    expect(res.map((r) => r.status).filter((s) => s >= 500)).toEqual([]);
    expect(res.map((r) => r.status)).toContain(204);
    const [row] = await c.sql`select count(*)::int as n from hub.room_members
      where room_id = ${g.id} and role = 'owner' and left_at is null`;
    expect(row?.n).toBe(1);
  });

  it("HUB-FR-98 · P07 · bớt B song song B gửi ⇒ 201 hoặc 404; không có tin nào của B sau left_at [X2a-R13 · R20]", async () => {
    const [a, b] = [await c.tok("lan"), await c.tok("hoa")];
    for (let i = 0; i < 5; i++) {
      const g = await mkGroup(c.hub, a, [P.hoa.id], `P07-${i}`);
      const [rm, send] = await Promise.all([
        api(c.hub, a, "DELETE", `/rooms/${g.id}/members/${P.hoa.id}`),
        api(c.hub, b, "POST", `/rooms/${g.id}/messages`, {
          content: `P07-${i}`,
          client_msg_id: cm(),
        }),
      ]);
      expect(rm.status).toBe(204);
      expect([201, 404]).toContain(send.status);
      const late = await c.sql`select m.seq from hub.room_messages m join hub.room_members x
        on x.room_id = m.room_id and x.user_id = m.sender_id
        where m.room_id = ${g.id} and m.sender_id = ${P.hoa.id} and m.created_at > x.left_at`;
      expect(late.length).toBe(0);
    }
  });
});
