// HUB-FR-96 · HUB-FR-100 · AC-H24 · AC-H25 · X2a-AC07 · X2a-AC09 · X2a-AC14 · tin + chưa đọc/đã đọc (test-plan X2a §5.2
// M01–M14; plan §2.3, §3, D5, D6). Phòng tạo qua API trong từng `it`. Sự kiện đọc qua `/me/stream` (M14).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  api,
  type Ctx,
  cm,
  codeOf,
  e400,
  listItem,
  mkGroup,
  msgEv,
  openMeStream,
  P,
  say,
  sentinel,
  startX2a,
} from "./_x2a";

let c: Ctx & { stop: () => Promise<void> };
beforeAll(async () => {
  c = await startX2a();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const G = async () => (await mkGroup(c.hub, await c.tok("lan"), [P.hoa.id, P.tam.id])).id as string;
const seqs = (page: { items: { seq: number }[] }) => page.items.map((m) => m.seq);

describe("M01–M06 · gửi, lịch sử, client_msg_id [X2a-R14 · R15 · X2a-AC07]", () => {
  it("HUB-FR-96 · M01 · gửi ⇒ 201 RoomMessage seq 1,2,3; sender đúng, client_msg_id trả lại [X2a-R15]", async () => {
    const g = await G();
    const a = await c.tok("lan");
    const out: number[] = [];
    for (const t of ["một", "hai", "ba"]) {
      const id = cm();
      const r = await api(c.hub, a, "POST", `/rooms/${g}/messages`, {
        content: t,
        client_msg_id: id,
      });
      expect(r.status).toBe(201);
      expect(r.json).toMatchObject({
        room_id: g,
        content: t,
        client_msg_id: id,
        sender_type: "user",
      });
      expect(r.json.sender).toMatchObject({ id: P.lan.id });
      out.push(r.json.seq);
    }
    expect(out).toEqual([1, 2, 3]);
  });

  it('HUB-FR-96 · M02 · content ""/"  "/16001 ⇒ 400 VALIDATION_ERROR; 16000 ⇒ 201; content được trim [X2a-R15]', async () => {
    const g = await G();
    const a = await c.tok("lan");
    for (const content of ["", "   ", "a".repeat(16_001)])
      expect(
        codeOf(
          await api(c.hub, a, "POST", `/rooms/${g}/messages`, { content, client_msg_id: cm() }),
        ),
      ).toEqual(e400);
    expect(
      codeOf(await api(c.hub, a, "POST", `/rooms/${g}/messages`, { content: "thiếu id" })),
    ).toEqual(e400);
    const big = await api(c.hub, a, "POST", `/rooms/${g}/messages`, {
      content: "a".repeat(16_000),
      client_msg_id: cm(),
    });
    expect(big.status).toBe(201);
    const t = await say(c.hub, a, g, "  có khoảng trắng  ");
    expect(t.content).toBe("có khoảng trắng");
  });

  it("HUB-FR-96 · M03 · 55 tin: GET mặc định 50 tin cuối tăng dần, has_more=true; before_seq=6 ⇒ 1..5, has_more=false; limit=2 [X2a-R15]", async () => {
    const g = await G();
    const a = await c.tok("lan");
    for (let i = 1; i <= 55; i++) await say(c.hub, a, g, `Tin số ${i}`);
    const p1 = await api(c.hub, a, "GET", `/rooms/${g}/messages`);
    expect(p1.status).toBe(200);
    expect(seqs(p1.json)).toEqual(Array.from({ length: 50 }, (_, i) => i + 6));
    expect(p1.json.has_more).toBe(true);
    const p2 = await api(c.hub, a, "GET", `/rooms/${g}/messages?before_seq=6`);
    expect({ s: seqs(p2.json), more: p2.json.has_more }).toEqual({
      s: [1, 2, 3, 4, 5],
      more: false,
    });
    const p3 = await api(c.hub, a, "GET", `/rooms/${g}/messages?limit=2&before_seq=10`);
    expect({ s: seqs(p3.json), more: p3.json.has_more }).toEqual({ s: [8, 9], more: true });
    expect(codeOf(await api(c.hub, a, "GET", `/rooms/${g}/messages?limit=0`))).toEqual(e400);
  });

  it("HUB-FR-96 · M04 · cùng client_msg_id lần 2 ⇒ 200, cùng id, 1 hàng, không sự kiện mới [X2a-R15 · X2a-AC07]", async () => {
    const g = await G();
    const a = await c.tok("lan");
    const b = await c.tok("hoa");
    const s = await openMeStream(c.hub, b);
    expect(s.status).toBe(200);
    const id = cm();
    const body = { content: "Gửi lại M04", client_msg_id: id };
    const r1 = await api(c.hub, a, "POST", `/rooms/${g}/messages`, body);
    const r2 = await api(c.hub, a, "POST", `/rooms/${g}/messages`, body);
    expect({ s1: r1.status, s2: r2.status, same: r2.json?.id === r1.json?.id }).toEqual({
      s1: 201,
      s2: 200,
      same: true,
    });
    const [n] = await c.sql`select count(*)::int as n from hub.room_messages where room_id = ${g}`;
    expect(n?.n).toBe(1);
    expect(await sentinel(c.hub, b, s, "M04")).toBe(true);
    expect(s.events.filter(msgEv("Gửi lại M04")).length).toBe(1);
    s.close();
  });

  it("HUB-FR-96 · M05 · khác người gửi cùng client_msg_id ⇒ 2 tin (seq 1, 2) [X2a-R15]", async () => {
    const g = await G();
    const id = cm();
    const r1 = await api(c.hub, await c.tok("lan"), "POST", `/rooms/${g}/messages`, {
      content: "A",
      client_msg_id: id,
    });
    const r2 = await api(c.hub, await c.tok("hoa"), "POST", `/rooms/${g}/messages`, {
      content: "B",
      client_msg_id: id,
    });
    expect([r1.status, r2.status, r1.json?.seq, r2.json?.seq]).toEqual([201, 201, 1, 2]);
  });

  it("HUB-FR-96 · M06 · người được thêm sau 10 tin ⇒ GET /messages từ seq 1; unread=0 lúc vào (D6) [X2a-R14 · AC-H24]", async () => {
    const g = await G();
    const a = await c.tok("lan");
    for (let i = 1; i <= 10; i++) await say(c.hub, a, g, `Lịch sử ${i}`);
    expect(
      (await api(c.hub, a, "POST", `/rooms/${g}/members`, { user_ids: [P.cuc.id] })).status,
    ).toBe(200);
    const cTok = await c.tok("cuc");
    const h = await api(c.hub, cTok, "GET", `/rooms/${g}/messages`);
    expect(seqs(h.json)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(await listItem(c.hub, cTok, g)).toMatchObject({ unread: 0, last_seq: 10 });
  });
});

// Tranh chấp 2026-10-08 (X2b B4): X2b-R02 (CR-048) bật gọi agent khi tag **đầu tin**; ý định R16 còn đúng cho tag giữa câu.
describe("M08 · @ là chữ [X2a-R16 · X2a-AC14 · X2b-R02]", () => {
  it('HUB-FR-96 · M08 · tin "Nhờ @assistant tóm tắt" (tag giữa câu) ⇒ 201, content nguyên văn, hub.runs không tăng [X2a-R16 · X2a-AC14 · X2b-R02]', async () => {
    const g = await G();
    const [before] = await c.sql`select count(*)::int as n from hub.runs`;
    const m = await say(c.hub, await c.tok("lan"), g, "Nhờ @assistant tóm tắt giúp");
    expect(m.content).toBe("Nhờ @assistant tóm tắt giúp");
    const [after] = await c.sql`select count(*)::int as n from hub.runs`;
    expect(after?.n).toBe(before?.n);
  });
});

describe("M09–M14 · chưa đọc, đã đọc [X2a-R17 · R18 · R19 · AC-H25 · X2a-AC09]", () => {
  it("HUB-FR-100 · M09–M10 · A gửi 3 ⇒ B, E unread=3; A unread=0 (tin của mình không tính) [X2a-R17 · R18 · AC-H25]", async () => {
    const g = await G();
    const a = await c.tok("lan");
    for (const t of ["1", "2", "3"]) await say(c.hub, a, g, `M09-${t}`);
    expect(await listItem(c.hub, await c.tok("hoa"), g)).toMatchObject({ unread: 3, last_seq: 3 });
    expect(await listItem(c.hub, await c.tok("tam"), g)).toMatchObject({ unread: 3 });
    expect(await listItem(c.hub, a, g)).toMatchObject({ unread: 0 });
  });

  it("HUB-FR-100 · M11 · unread_total = tổng các phòng thấy được [X2a-R17]", async () => {
    const cTok = await c.tok("cuc");
    const a = await c.tok("lan");
    const t0 = (await api(c.hub, cTok, "GET", "/rooms")).json.unread_total;
    const g1 = await mkGroup(c.hub, a, [P.cuc.id], "M11 một");
    const g2 = await mkGroup(c.hub, a, [P.cuc.id], "M11 hai");
    await say(c.hub, a, g1.id, "x");
    await say(c.hub, a, g2.id, "y");
    await say(c.hub, a, g2.id, "z");
    const r = await api(c.hub, cTok, "GET", "/rooms");
    expect(r.json.unread_total).toBe(t0 + 3);
  });

  it("HUB-FR-100 · M12–M13 · read {seq:3} rồi {seq:2} ⇒ không lùi; {seq:999} ⇒ last_read_seq = last_seq; trả {unread, unread_total} [X2a-R18 · X2a-AC09]", async () => {
    const g = await G();
    const a = await c.tok("lan");
    for (let i = 1; i <= 5; i++) await say(c.hub, a, g, `M12-${i}`);
    const b = await c.tok("hoa");
    const r3 = await api(c.hub, b, "POST", `/rooms/${g}/read`, { seq: 3 });
    expect(r3.status).toBe(200);
    expect(r3.json.unread).toBe(2);
    expect(typeof r3.json.unread_total).toBe("number");
    const r2 = await api(c.hub, b, "POST", `/rooms/${g}/read`, { seq: 2 });
    expect(r2.json.unread).toBe(2);
    const r9 = await api(c.hub, b, "POST", `/rooms/${g}/read`, { seq: 999 });
    expect(r9.json.unread).toBe(0);
    const d = (await api(c.hub, a, "GET", `/rooms/${g}`)).json;
    const mb = d.members.find((m: { id: string }) => m.id === P.hoa.id);
    expect(mb.last_read_seq).toBe(5);
    expect(codeOf(await api(c.hub, b, "POST", `/rooms/${g}/read`, { seq: -1 }))).toEqual(e400);
  });

  it("HUB-FR-100 · M14 · B đọc ⇒ A, E nhận room.read {room_id, user_id:B, seq}; B nhận room.unread, không nhận room.read của mình [X2a-R19 · X2a-AC09]", async () => {
    const g = await G();
    const a = await c.tok("lan");
    await say(c.hub, a, g, "M14-1");
    await say(c.hub, a, g, "M14-2");
    const [sa, sb, se] = [
      await openMeStream(c.hub, a),
      await openMeStream(c.hub, await c.tok("hoa")),
      await openMeStream(c.hub, await c.tok("tam")),
    ];
    expect([sa.status, sb.status, se.status]).toEqual([200, 200, 200]);
    expect(
      (await api(c.hub, await c.tok("hoa"), "POST", `/rooms/${g}/read`, { seq: 2 })).status,
    ).toBe(200);
    const isRead = (e: { event: string; data: { room_id?: string } }) =>
      e.event === "room.read" && e.data?.room_id === g;
    for (const s of [sa, se])
      expect((await s.until(isRead, 2_000))?.data).toEqual({
        room_id: g,
        user_id: P.hoa.id,
        seq: 2,
      });
    const un = await sb.until((e) => e.event === "room.unread" && e.data?.room_id === g, 2_000);
    expect(un?.data).toMatchObject({ room_id: g, unread: 0 });
    expect(await sentinel(c.hub, await c.tok("hoa"), sb, "M14")).toBe(true);
    expect(sb.events.filter(isRead)).toEqual([]);
    for (const s of [sa, sb, se]) expect(s.events.every((e) => e.valid)).toBe(true);
    for (const s of [sa, sb, se]) s.close();
  });
});
