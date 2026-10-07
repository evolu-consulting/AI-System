// HUB-FR-98 · AC-H24 · X2a-AC04 · X2a-AC05 · đổi tên, thêm/bớt, rời, chuyển chủ, xoá (test-plan X2a §5.2 O15–O29; plan §3,
// plan-db §5). Phòng tạo qua API trong từng `it`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  api,
  type Ctx,
  codeOf,
  e400,
  e404,
  eUser,
  listItem,
  mkGroup,
  P,
  qIds,
  say,
  startX2a,
} from "./_x2a";

let c: Ctx & { stop: () => Promise<void> };
beforeAll(async () => {
  c = await startX2a();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const owner403 = { status: 403, code: "NOT_ROOM_OWNER" };
const G = async () => (await mkGroup(c.hub, await c.tok("lan"), [P.hoa.id, P.tam.id])).id as string;
const memberIds = (detail: { members: { id: string }[] }) => detail.members.map((m) => m.id).sort();

describe("O15–O22 · đổi tên, thêm, bớt [X2a-R04 · R08 · R09]", () => {
  it("HUB-FR-98 · O15 · chủ đổi tên ⇒ 200, tên đã trim; GET thấy tên mới [X2a-R09]", async () => {
    const g = await G();
    const a = await c.tok("lan");
    const r = await api(c.hub, a, "PATCH", `/rooms/${g}`, { name: "  Tên mới  " });
    expect(r.status).toBe(200);
    expect(r.json.name).toBe("Tên mới");
    expect((await api(c.hub, await c.tok("hoa"), "GET", `/rooms/${g}`)).json.name).toBe("Tên mới");
    expect(codeOf(await api(c.hub, a, "PATCH", `/rooms/${g}`, { name: "a".repeat(81) }))).toEqual(
      e400,
    );
  });

  it("HUB-FR-98 · O16 · B (thành viên) đổi tên/thêm/bớt/xoá/chuyển ⇒ 403 NOT_ROOM_OWNER, không ghi [X2a-R04 · AC-H24]", async () => {
    const g = await G();
    const b = await c.tok("hoa");
    const before = (await api(c.hub, b, "GET", `/rooms/${g}`)).json;
    for (const [m, p, body] of [
      ["PATCH", `/rooms/${g}`, { name: "B đổi" }],
      ["POST", `/rooms/${g}/members`, { user_ids: [P.cuc.id] }],
      ["DELETE", `/rooms/${g}/members/${P.tam.id}`, undefined],
      ["DELETE", `/rooms/${g}`, undefined],
      ["POST", `/rooms/${g}/transfer`, { user_id: P.hoa.id }],
    ] as const)
      expect({ m, p, r: codeOf(await api(c.hub, b, m, p, body)) }).toEqual({ m, p, r: owner403 });
    const after = (await api(c.hub, b, "GET", `/rooms/${g}`)).json;
    expect({ name: after.name, owner: after.owner_id, mem: memberIds(after) }).toEqual({
      name: before.name,
      owner: before.owner_id,
      mem: memberIds(before),
    });
  });

  it("HUB-FR-98 · O17 · thêm C ⇒ 200 RoomDetail có C; thêm người đã có ⇒ 200 không đổi (idempotent) [X2a-R09]", async () => {
    const g = await G();
    const a = await c.tok("lan");
    const r = await api(c.hub, a, "POST", `/rooms/${g}/members`, { user_ids: [P.cuc.id] });
    expect(r.status).toBe(200);
    expect(memberIds(r.json)).toEqual([P.lan.id, P.hoa.id, P.tam.id, P.cuc.id].sort());
    expect(r.json.member_count).toBe(4);
    const again = await api(c.hub, a, "POST", `/rooms/${g}/members`, {
      user_ids: [P.cuc.id, P.hoa.id],
    });
    expect(again.status).toBe(200);
    expect(again.json.member_count).toBe(4);
  });

  it("HUB-FR-98 · O18–O19 · thêm user tenant khác/khoá/không hoạt động ⇒ 404 USER_NOT_FOUND, không ghi; body tenant_id thừa ⇒ 400 [X2a-R01 · R02 · AC-H24]", async () => {
    const g = await G();
    const a = await c.tok("lan");
    for (const u of [P.an.id, P.khoa.id, P.nghi.id, P.zed.id]) {
      const r = await api(c.hub, a, "POST", `/rooms/${g}/members`, { user_ids: [P.cuc.id, u] });
      expect({ u, r: codeOf(r), d: r.json?.error?.details }).toEqual({
        u,
        r: eUser,
        d: { user_ids: [u] },
      });
    }
    expect((await api(c.hub, a, "GET", `/rooms/${g}`)).json.member_count).toBe(3);
    const extra = await api(c.hub, a, "POST", `/rooms/${g}/members`, {
      user_ids: [P.cuc.id],
      tenant_id: P.an.tid,
    });
    expect(codeOf(extra)).toEqual(e400);
  });

  it("HUB-FR-98 · O20 · nhóm 50 + thêm 1 ⇒ 409 ROOM_FULL {max:50, requested:51}, không ghi [X2a-R08 · AC-H24]", async () => {
    const a = await c.tok("lan");
    const g = await mkGroup(c.hub, a, qIds(1, 49), "Nhóm đủ 50");
    const r = await api(c.hub, a, "POST", `/rooms/${g.id}/members`, { user_ids: [P.cuc.id] });
    expect(codeOf(r)).toEqual({ status: 409, code: "ROOM_FULL" });
    expect(r.json.error.details).toEqual({ max: 50, requested: 51 });
    expect((await api(c.hub, a, "GET", `/rooms/${g.id}`)).json.member_count).toBe(50);
    const g48 = await mkGroup(c.hub, a, qIds(1, 47), "Nhóm 48");
    const two = await api(c.hub, a, "POST", `/rooms/${g48.id}/members`, { user_ids: qIds(48, 3) });
    expect(codeOf(two)).toEqual({ status: 409, code: "ROOM_FULL" });
    expect((await api(c.hub, a, "GET", `/rooms/${g48.id}`)).json.member_count).toBe(48);
  });

  it("HUB-FR-98 · O21 · bớt B ⇒ 204, B không còn trong members; bớt chính mình ⇒ 400; bớt người ngoài ⇒ 404 USER_NOT_FOUND [X2a-R09]", async () => {
    const g = await G();
    const a = await c.tok("lan");
    expect((await api(c.hub, a, "DELETE", `/rooms/${g}/members/${P.hoa.id}`)).status).toBe(204);
    expect(memberIds((await api(c.hub, a, "GET", `/rooms/${g}`)).json)).toEqual(
      [P.lan.id, P.tam.id].sort(),
    );
    expect(codeOf(await api(c.hub, a, "DELETE", `/rooms/${g}/members/${P.lan.id}`))).toEqual(e400);
    expect(codeOf(await api(c.hub, a, "DELETE", `/rooms/${g}/members/${P.cuc.id}`))).toEqual(eUser);
    expect(codeOf(await api(c.hub, a, "DELETE", `/rooms/${g}/members/${P.hoa.id}`))).toEqual(eUser);
  });
});

describe("O23–O27 · rời, chuyển chủ [X2a-R10 · R11 · X2a-AC04]", () => {
  it("HUB-FR-98 · O23 · B rời ⇒ 204; G mất khỏi /rooms của B; B GET ⇒ 404 [X2a-R10 · AC-H24]", async () => {
    const g = await G();
    const a = await c.tok("lan");
    await say(c.hub, a, g, "trước khi B rời");
    const b = await c.tok("hoa");
    expect(await listItem(c.hub, b, g)).toBeDefined();
    expect((await api(c.hub, b, "POST", `/rooms/${g}/leave`)).status).toBe(204);
    expect(await listItem(c.hub, b, g)).toBeUndefined();
    expect(codeOf(await api(c.hub, b, "GET", `/rooms/${g}`))).toEqual(e404);
  });

  it("HUB-FR-98 · O24 · chủ rời khi còn người ⇒ 409 OWNER_MUST_TRANSFER, vẫn là chủ [X2a-R10 · X2a-AC04]", async () => {
    const g = await G();
    const a = await c.tok("lan");
    expect(codeOf(await api(c.hub, a, "POST", `/rooms/${g}/leave`))).toEqual({
      status: 409,
      code: "OWNER_MUST_TRANSFER",
    });
    expect((await api(c.hub, a, "GET", `/rooms/${g}`)).json.owner_id).toBe(P.lan.id);
  });

  it("HUB-FR-98 · O25 · chuyển sang C (không thành viên) / chính mình / B đã rời ⇒ 404 USER_NOT_FOUND [X2a-R11]", async () => {
    const g = await G();
    const a = await c.tok("lan");
    expect((await api(c.hub, await c.tok("tam"), "POST", `/rooms/${g}/leave`)).status).toBe(204);
    for (const u of [P.cuc.id, P.lan.id, P.tam.id])
      expect({
        u,
        r: codeOf(await api(c.hub, a, "POST", `/rooms/${g}/transfer`, { user_id: u })),
      }).toEqual({
        u,
        r: eUser,
      });
  });

  it("HUB-FR-98 · O26 · chuyển sang B ⇒ 200 owner_id=B, A thành member; sau đó A rời ⇒ 204 [X2a-R10 · R11 · X2a-AC04]", async () => {
    const g = await G();
    const a = await c.tok("lan");
    const r = await api(c.hub, a, "POST", `/rooms/${g}/transfer`, { user_id: P.hoa.id });
    expect(r.status).toBe(200);
    const d = (await api(c.hub, a, "GET", `/rooms/${g}`)).json;
    expect(d.owner_id).toBe(P.hoa.id);
    expect(d.my_role).toBe("member");
    const roles = Object.fromEntries(
      d.members.map((m: { id: string; role: string }) => [m.id, m.role]),
    );
    expect(roles).toEqual({ [P.lan.id]: "member", [P.hoa.id]: "owner", [P.tam.id]: "member" });
    expect((await api(c.hub, a, "POST", `/rooms/${g}/leave`)).status).toBe(204);
    expect(codeOf(await api(c.hub, a, "GET", `/rooms/${g}`))).toEqual(e404);
    expect((await api(c.hub, await c.tok("hoa"), "GET", `/rooms/${g}`)).json.member_count).toBe(2);
  });

  it("HUB-FR-98 · O27 · chủ là người duy nhất rời ⇒ 204, phòng xoá (404, deleted_at có) [X2a-R10 · X2a-AC04]", async () => {
    const a = await c.tok("lan");
    const g = await mkGroup(c.hub, a, [], "Một mình");
    expect((await api(c.hub, a, "POST", `/rooms/${g.id}/leave`)).status).toBe(204);
    expect(codeOf(await api(c.hub, a, "GET", `/rooms/${g.id}`))).toEqual(e404);
    const [row] = await c.sql`select deleted_at from hub.rooms where id = ${g.id}`;
    expect(row?.deleted_at).not.toBeNull();
  });
});

describe("O28–O29 · xoá phòng [X2a-R12 · X2a-AC05]", () => {
  it("HUB-FR-98 · O28 · chủ xoá ⇒ 204; A, B, E GET ⇒ 404; deleted_at có, không thành viên hoạt động [X2a-R12 · X2a-AC05]", async () => {
    const g = await G();
    expect((await api(c.hub, await c.tok("lan"), "DELETE", `/rooms/${g}`)).status).toBe(204);
    for (const w of ["lan", "hoa", "tam"] as const)
      expect({ w, r: codeOf(await api(c.hub, await c.tok(w), "GET", `/rooms/${g}`)) }).toEqual({
        w,
        r: e404,
      });
    const [row] = await c.sql`select deleted_at, (select count(*)::int from hub.room_members
      where room_id = ${g} and left_at is null) as active from hub.rooms where id = ${g}`;
    expect(row?.deleted_at).not.toBeNull();
    expect(row?.active).toBe(0);
  });

  it("HUB-FR-98 · O29 · B xoá ⇒ 403 NOT_ROOM_OWNER, phòng còn [X2a-R04 · X2a-AC05]", async () => {
    const g = await G();
    expect(codeOf(await api(c.hub, await c.tok("hoa"), "DELETE", `/rooms/${g}`))).toEqual(owner403);
    expect((await api(c.hub, await c.tok("lan"), "GET", `/rooms/${g}`)).status).toBe(200);
  });
});
