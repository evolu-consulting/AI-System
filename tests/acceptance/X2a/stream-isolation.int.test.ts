// HUB-BR-22 · HUB-FR-99 · AC-H23 · X2a-AC03 · X2a-AC05 · X2a-AC06 · cách ly sự kiện `/me/stream` (test-plan X2a §5.4 S01–S07;
// spec R20; plan-db §5 cột "Sự kiện"). "Không sự kiện" khẳng định bằng sentinel (Redis Stream giữ thứ tự một khoá).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  api,
  type Ctx,
  codeOf,
  e404,
  type MeEv,
  mkDm,
  mkGroup,
  msgEv,
  ofRoom,
  openMeStream,
  P,
  qIds,
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
const evIn = (name: string, room: string) => (e: MeEv) =>
  e.event === name && e.data?.room_id === room;

describe("S01 · người ngoài không nhận sự kiện [AC-H23 · X2a-R20]", () => {
  it("HUB-BR-22 · S01 · C, tadmin, an, padmin nối stream; A gửi/đổi tên/thêm/bớt/B đọc/xoá G + gửi DM A–B ⇒ sentinel tới, 0 sự kiện G/DM [AC-H23 · X2a-R20]", async () => {
    const viewers = ["cuc", "tadmin", "an", "padmin"] as const;
    const toks = await Promise.all(viewers.map((w) => c.tok(w)));
    const ss = await Promise.all(toks.map((t) => openMeStream(c.hub, t)));
    expect(ss.map((s) => s.status)).toEqual([200, 200, 200, 200]);
    const [a, b] = [await c.tok("lan"), await c.tok("hoa")];
    const g = await G();
    const dm = await mkDm(c.hub, a, P.hoa.id);
    await say(c.hub, a, g, "S01 G");
    expect((await api(c.hub, a, "PATCH", `/rooms/${g}`, { name: "S01 đổi" })).status).toBe(200);
    expect(
      (await api(c.hub, a, "POST", `/rooms/${g}/members`, { user_ids: qIds(1, 1) })).status,
    ).toBe(200);
    expect((await api(c.hub, a, "DELETE", `/rooms/${g}/members/${qIds(1, 1)[0]}`)).status).toBe(
      204,
    );
    expect((await api(c.hub, b, "POST", `/rooms/${g}/read`, { seq: 1 })).status).toBe(200);
    await say(c.hub, a, dm.id, "S01 DM");
    expect((await api(c.hub, a, "DELETE", `/rooms/${g}`)).status).toBe(204);
    for (const [i, s] of ss.entries()) {
      expect({
        w: viewers[i],
        ok: await sentinel(c.hub, toks[i] as string, s, `S01-${i}`),
      }).toEqual({ w: viewers[i], ok: true });
      expect({ w: viewers[i], g: ofRoom(s, g), dm: ofRoom(s, dm.id) }).toEqual({
        w: viewers[i],
        g: [],
        dm: [],
      });
      expect(s.events.every((e) => e.valid)).toBe(true);
      s.close();
    }
  });
});

describe("S02–S05 · mất quyền: đúng 1 sự kiện rồi hết [X2a-AC03 · X2a-AC05 · X2a-R13 · R20]", () => {
  async function removedThenSilent(how: "remove" | "leave"): Promise<void> {
    const g = await G();
    const [a, b] = [await c.tok("lan"), await c.tok("hoa")];
    const s = await openMeStream(c.hub, b);
    expect(s.status).toBe(200);
    const r =
      how === "remove"
        ? await api(c.hub, a, "DELETE", `/rooms/${g}/members/${P.hoa.id}`)
        : await api(c.hub, b, "POST", `/rooms/${g}/leave`);
    expect(r.status).toBe(204);
    const ev = await s.until(evIn("room.member_removed", g), 2_000);
    expect(ev?.data).toEqual({ room_id: g, user_id: P.hoa.id });
    await say(c.hub, a, g, `sau khi ${how}`);
    expect(
      (await api(c.hub, a, "PATCH", `/rooms/${g}`, { name: "Sau khi mất quyền" })).status,
    ).toBe(200);
    expect(await sentinel(c.hub, b, s, `S-${how}`)).toBe(true);
    expect(ofRoom(s, g).map((e) => e.event)).toEqual(["room.member_removed"]);
    s.close();
  }

  it("HUB-FR-99 · S02 · A bớt B ⇒ B nhận đúng 1 room.member_removed {user_id:B}; A gửi tiếp + đổi tên ⇒ B không nhận thêm gì của G [X2a-R20 · X2a-AC03]", async () => {
    await removedThenSilent("remove");
  });

  it("HUB-FR-99 · S03 · B tự rời ⇒ đúng 1 room.member_removed rồi hết [X2a-R20 · X2a-AC03]", async () => {
    await removedThenSilent("leave");
  });

  it("HUB-FR-99 · S04 · thêm lại B ⇒ B nhận room.member_added kèm room (RoomSummary); GET /messages từ seq 1 [X2a-R13 · R14 · X2a-AC03]", async () => {
    const g = await G();
    const [a, b] = [await c.tok("lan"), await c.tok("hoa")];
    await say(c.hub, a, g, "S04-1");
    expect((await api(c.hub, a, "DELETE", `/rooms/${g}/members/${P.hoa.id}`)).status).toBe(204);
    await say(c.hub, a, g, "S04-2");
    const s = await openMeStream(c.hub, b);
    expect(s.status).toBe(200);
    expect(
      (await api(c.hub, a, "POST", `/rooms/${g}/members`, { user_ids: [P.hoa.id] })).status,
    ).toBe(200);
    const ev = await s.until(
      (e) => evIn("room.member_added", g)(e) && e.data?.user_id === P.hoa.id,
      2_000,
    );
    expect(ev?.valid).toBe(true);
    expect(ev?.data?.room).toMatchObject({ id: g, kind: "group", my_role: "member" });
    const h = await api(c.hub, b, "GET", `/rooms/${g}/messages`);
    expect(h.json.items.map((m: { seq: number }) => m.seq)).toEqual([1, 2]);
    s.close();
  });

  it("HUB-FR-98 · S05 · xoá G ⇒ A, B, E mỗi người đúng 1 room.deleted; sau đó không sự kiện G; GET ⇒ 404 [X2a-R12 · X2a-AC05]", async () => {
    const g = await G();
    const ws = ["lan", "hoa", "tam"] as const;
    const toks = await Promise.all(ws.map((w) => c.tok(w)));
    const ss = await Promise.all(toks.map((t) => openMeStream(c.hub, t)));
    expect(ss.map((s) => s.status)).toEqual([200, 200, 200]);
    expect((await api(c.hub, toks[0] as string, "DELETE", `/rooms/${g}`)).status).toBe(204);
    for (const [i, s] of ss.entries()) {
      await s.until(evIn("room.deleted", g), 2_000);
      expect(await sentinel(c.hub, toks[i] as string, s, `S05-${i}`)).toBe(true);
      expect({ w: ws[i], evs: ofRoom(s, g).map((e) => e.event) }).toEqual({
        w: ws[i],
        evs: ["room.deleted"],
      });
      expect(codeOf(await api(c.hub, toks[i] as string, "GET", `/rooms/${g}`))).toEqual(e404);
      s.close();
    }
  });
});

describe("S06–S07 · DM ẩn, Last-Event-ID của người khác [X2a-R07 · HUB-BR-22]", () => {
  it("HUB-FR-97 · S06 · A ẩn DM; B gửi ⇒ A vẫn nhận room.message + room.unread [X2a-R07 · X2a-AC06]", async () => {
    const [a, b] = [await c.tok("lan"), await c.tok("hoa")];
    const dm = await mkDm(c.hub, a, P.hoa.id);
    await say(c.hub, a, dm.id, "S06 trước");
    expect((await api(c.hub, a, "POST", `/rooms/${dm.id}/hide`)).status).toBe(204);
    const s = await openMeStream(c.hub, a);
    expect(s.status).toBe(200);
    await say(c.hub, b, dm.id, "S06 hiện lại");
    expect(await s.until(msgEv("S06 hiện lại"), 2_000)).toBeDefined();
    const un = await s.until((e) => evIn("room.unread", dm.id)(e) && e.data?.unread >= 1, 2_000);
    expect(un).toBeDefined();
    s.close();
  });

  it("HUB-BR-22 · S07 · C nối với Last-Event-ID = id thuộc stream của B ⇒ không nhận sự kiện nào của B [X2a-R20 · spec-isolation §1]", async () => {
    const g = await G();
    const [a, b, ct] = [await c.tok("lan"), await c.tok("hoa"), await c.tok("cuc")];
    const sb = await openMeStream(c.hub, b);
    expect(sb.status).toBe(200);
    await say(c.hub, a, g, "S07-1");
    const first = await sb.until(msgEv("S07-1"), 2_000);
    const bId = first?.id ?? "1-0";
    sb.close();
    await say(c.hub, a, g, "S07-2");
    const sc = await openMeStream(c.hub, ct, { lastId: bId });
    expect(sc.status).toBe(200);
    expect(await sentinel(c.hub, ct, sc, "S07")).toBe(true);
    expect(ofRoom(sc, g)).toEqual([]);
    sc.close();
  });
});
