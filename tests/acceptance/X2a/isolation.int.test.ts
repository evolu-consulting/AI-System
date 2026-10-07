// HUB-BR-22 · HUB-FR-96 · AC-H23 · X2a-AC02 · X2a-AC03 · cách ly API `/rooms/:id*` (test-plan X2a §4 I01–I15; plan §3 thứ tự
// kiểm). Người ngoài (C cùng tenant, tadmin, an/beta, padmin, đã rời, bị bớt, phòng xoá) ⇒ 404 `ROOM_NOT_FOUND` ở cả 14 lời
// gọi, body hợp lệ lẫn sai (404 trước 400/403), DB không đổi. Phòng tạo qua API trong từng `it`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  all,
  api,
  type Ctx,
  codeOf,
  e404,
  hitAll,
  listItem,
  mkDm,
  mkGroup,
  P,
  roomEndpoints,
  roomState,
  say,
  startX2a,
  UNKNOWN_ROOM,
  type Who,
} from "./_x2a";

let c: Ctx & { stop: () => Promise<void> };
beforeAll(async () => {
  c = await startX2a();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

/** G = nhóm {A chủ, B, E} có 2 tin. */
async function G(): Promise<string> {
  const a = await c.tok("lan");
  const g = await mkGroup(c.hub, a, [P.hoa.id, P.tam.id]);
  await say(c.hub, a, g.id, "Tin 1 của G");
  await say(c.hub, await c.tok("hoa"), g.id, "Tin 2 của G");
  return g.id;
}

/** Người `who` gọi 14 endpoint (hợp lệ + sai) ⇒ 404 hết, DB không đổi. */
async function outsider(who: Who, roomId: string): Promise<void> {
  const before = await roomState(c.sql, roomId);
  const t = await c.tok(who);
  const ok = roomEndpoints(roomId, P.tam.id, true);
  const bad = roomEndpoints(roomId, P.tam.id, false);
  expect(await hitAll(c.hub, t, ok)).toEqual(all(ok, e404));
  expect(await hitAll(c.hub, t, bad)).toEqual(all(bad, e404));
  expect(await roomState(c.sql, roomId)).toEqual(before);
}

describe("I01–I02 · id lạ ⇒ 404 giống hệt [X2a-R03]", () => {
  it("HUB-BR-22 · I01 · `:id` không phải uuid ⇒ 404 ROOM_NOT_FOUND ở mọi endpoint [X2a-R03 · X2a-AC02]", async () => {
    const t = await c.tok("lan");
    const eps = roomEndpoints("khong-phai-uuid", P.hoa.id);
    expect(await hitAll(c.hub, t, eps)).toEqual(all(eps, e404));
  });

  it("HUB-BR-22 · I02 · uuid không tồn tại ⇒ 404 ROOM_NOT_FOUND; thân trả lời giống hệt phòng của người khác (I10) [X2a-R03 · AC-H23]", async () => {
    const g = await G();
    const t = await c.tok("cuc");
    const eps = roomEndpoints(UNKNOWN_ROOM, P.hoa.id);
    expect(await hitAll(c.hub, t, eps)).toEqual(all(eps, e404));
    const unknown = await api(c.hub, t, "GET", `/rooms/${UNKNOWN_ROOM}`);
    const other = await api(c.hub, t, "GET", `/rooms/${g}`);
    expect(other.json).toEqual(unknown.json);
    const um = await api(c.hub, t, "GET", `/rooms/${UNKNOWN_ROOM}/messages`);
    const om = await api(c.hub, t, "GET", `/rooms/${g}/messages`);
    expect(om.json).toEqual(um.json);
  });
});

describe("I03–I06 · người ngoài ⇒ 404 ×14, không ghi [X2a-AC02 · AC-H23]", () => {
  it("HUB-BR-22 · I03 · C (cùng tenant, không thành viên) ⇒ 404 ×14 (body hợp lệ + sai), DB không đổi [X2a-R03 · X2a-AC02 · I11]", async () => {
    await outsider("cuc", await G());
  });
  it("HUB-BR-22 · I04 · tadmin acme ⇒ 404 ×14, DB không đổi [X2a-R03 · AC-H23]", async () => {
    await outsider("tadmin", await G());
  });
  it("HUB-BR-22 · I05 · an (tenant beta) ⇒ 404 ×14, DB không đổi [X2a-R01 · R03]", async () => {
    await outsider("an", await G());
  });
  it("HUB-BR-22 · I06 · padmin (platform_admin) ⇒ 404 ×14, DB không đổi [X2a-R03]", async () => {
    await outsider("padmin", await G());
  });
});

describe("I07–I09 · mất quyền ⇒ 404 [X2a-AC03 · X2a-R12 · R13]", () => {
  it("HUB-FR-98 · I07 · B sau khi tự rời ⇒ 404 ×14, DB không đổi [X2a-R13 · X2a-AC03]", async () => {
    const g = await G();
    const b = await c.tok("hoa");
    expect((await api(c.hub, b, "POST", `/rooms/${g}/leave`)).status).toBe(204);
    await outsider("hoa", g);
  });

  it("HUB-FR-98 · I08 · B bị bớt ⇒ 404 ×14; thêm lại ⇒ 200 + lịch sử từ seq 1 [X2a-R13 · R14 · X2a-AC03]", async () => {
    const g = await G();
    const a = await c.tok("lan");
    expect((await api(c.hub, a, "DELETE", `/rooms/${g}/members/${P.hoa.id}`)).status).toBe(204);
    await outsider("hoa", g);
    expect(
      (await api(c.hub, a, "POST", `/rooms/${g}/members`, { user_ids: [P.hoa.id] })).status,
    ).toBe(200);
    const h = await api(c.hub, await c.tok("hoa"), "GET", `/rooms/${g}/messages`);
    expect(h.status).toBe(200);
    expect(h.json.items.map((m: { seq: number }) => m.seq)).toEqual([1, 2]);
  });

  it("HUB-FR-98 · I09 · phòng bị xoá ⇒ A, B, E đều 404 ×14 (kể cả chủ) [X2a-R12 · X2a-AC05]", async () => {
    const g = await G();
    expect((await api(c.hub, await c.tok("lan"), "DELETE", `/rooms/${g}`)).status).toBe(204);
    for (const w of ["lan", "hoa", "tam"] as const) await outsider(w, g);
  });
});

describe("I10 · thứ tự kiểm (plan §3) [X2a-R03 · R04 · R06]", () => {
  it("HUB-FR-98 · I10a · người ngoài gọi việc của chủ ⇒ 404 (không 403); thành viên thường ⇒ 403 NOT_ROOM_OWNER, kể cả body sai (403 trước 400) [X2a-R04]", async () => {
    const g = await G();
    const cTok = await c.tok("cuc");
    const bTok = await c.tok("hoa");
    const owner = [
      ["PATCH", `/rooms/${g}`, { name: "Tên mới" }],
      ["PATCH", `/rooms/${g}`, { name: "" }],
      ["DELETE", `/rooms/${g}`, undefined],
      ["POST", `/rooms/${g}/members`, { user_ids: [P.cuc.id] }],
      ["POST", `/rooms/${g}/members`, { user_ids: [] }],
      ["DELETE", `/rooms/${g}/members/${P.tam.id}`, undefined],
      ["POST", `/rooms/${g}/transfer`, { user_id: P.tam.id }],
      ["POST", `/rooms/${g}/transfer`, { user_id: "x" }],
    ] as const;
    for (const [m, p, body] of owner) {
      expect({ p, m, r: codeOf(await api(c.hub, cTok, m, p, body)) }).toEqual({ p, m, r: e404 });
      expect({ p, m, r: codeOf(await api(c.hub, bTok, m, p, body)) }).toEqual({
        p,
        m,
        r: { status: 403, code: "NOT_ROOM_OWNER" },
      });
    }
  });

  it("HUB-FR-97 · I10b · thành viên DM gọi đổi tên (body sai) ⇒ 409 DM_IMMUTABLE trước 403/400; người ngoài DM ⇒ 404 [X2a-R06]", async () => {
    const dm = await mkDm(c.hub, await c.tok("lan"), P.hoa.id);
    const b = await c.tok("hoa");
    expect(codeOf(await api(c.hub, b, "PATCH", `/rooms/${dm.id}`, { name: "" }))).toEqual({
      status: 409,
      code: "DM_IMMUTABLE",
    });
    expect(
      codeOf(await api(c.hub, await c.tok("cuc"), "PATCH", `/rooms/${dm.id}`, { name: "" })),
    ).toEqual(e404);
  });
});

describe("I12–I15 · DM, danh sách, ẩn, C1 [X2a-R03 · R07 · R23]", () => {
  it("HUB-BR-22 · I12 · C, tadmin, an, padmin × DM A–B ⇒ 404 ×14, DB không đổi [X2a-R03 · AC-H23]", async () => {
    const a = await c.tok("lan");
    const dm = await mkDm(c.hub, a, P.hoa.id);
    await say(c.hub, a, dm.id, "Tin DM");
    for (const w of ["cuc", "tadmin", "an", "padmin"] as const) await outsider(w, dm.id);
  });

  it("HUB-BR-22 · I13 · GET /rooms của C, tadmin, an, padmin không có G lẫn DM A–B [X2a-R03 · AC-H23]", async () => {
    const g = await G();
    const a = await c.tok("lan");
    const dm = await mkDm(c.hub, a, P.hoa.id);
    await say(c.hub, a, dm.id, "Tin DM I13");
    for (const w of ["cuc", "tadmin", "an", "padmin"] as const) {
      const t = await c.tok(w);
      const r = await api(c.hub, t, "GET", "/rooms?limit=200");
      expect({ w, s: r.status }).toEqual({ w, s: 200 });
      const ids = (r.json.items as { id: string }[]).map((i) => i.id);
      expect({ w, g: ids.includes(g), dm: ids.includes(dm.id) }).toEqual({
        w,
        g: false,
        dm: false,
      });
    }
  });

  it("HUB-FR-97 · I14 · A ẩn DM: vẫn là thành viên ⇒ GET /rooms/:id 200, /messages 200; không có trong GET /rooms [X2a-R07 · G6]", async () => {
    const a = await c.tok("lan");
    const dm = await mkDm(c.hub, a, P.hoa.id);
    await say(c.hub, a, dm.id, "Tin trước khi ẩn");
    expect((await api(c.hub, a, "POST", `/rooms/${dm.id}/hide`)).status).toBe(204);
    expect((await api(c.hub, a, "GET", `/rooms/${dm.id}`)).status).toBe(200);
    expect((await api(c.hub, a, "GET", `/rooms/${dm.id}/messages`)).status).toBe(200);
    expect(await listItem(c.hub, a, dm.id)).toBeUndefined();
  });

  it("HUB-BR-22 · I15 · C1 giữ nguyên: B gọi GET /conversations/:id của A ⇒ 404 (AC-H07); hub.messages không có cột room_id [X2a-R23]", async () => {
    const conv = "a1000000-0000-4000-8000-000000000201"; // H1 R.conv (của lan)
    const r = await api(c.hub, await c.tok("hoa"), "GET", `/conversations/${conv}`);
    expect(r.status).toBe(404);
    const cols = await c.sql`select column_name from information_schema.columns
      where table_schema = 'hub' and table_name = 'messages' and column_name = 'room_id'`;
    expect(cols.length).toBe(0);
  });
});
