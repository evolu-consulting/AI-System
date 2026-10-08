// HUB-FR-96 · HUB-FR-97 · HUB-FR-98 · HUB-BR-22 · X2a-AC01 · X2a-AC07 · test khoá cho review vòng 1: security-1 #1 #3 #4 #5 #8
// và review-1 #3 #4 #5 (test-plan-rv1.md). Lưới DB: role `hub_api` + `SET LOCAL ROLE hub_rw` + GUC như `withHubScope`.
// Dữ liệu phòng chèn bằng SQL owner TRONG `it`. Kiểm HÀNH VI (trạng thái sau thao tác), không phụ thuộc tên hàm nội bộ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { HUB_API_URL } from "../H1/_fixtures";
import {
  api,
  asUser,
  type Ctx,
  cm,
  codeOf,
  idGenX,
  mkDm,
  mkGroup,
  P,
  pgCode,
  type Sql,
  say,
  startX2a,
  T,
} from "./_x2a";

let c: Ctx & { stop: () => Promise<void> };
let owner: Sql;
let db: Sql;
const id = idGenX(60_000);
beforeAll(async () => {
  c = await startX2a();
  owner = c.sql;
  db = postgres(HUB_API_URL, { max: 4, onnotice: () => {} });
}, 60_000);
afterAll(async () => {
  await db?.end();
  await c?.stop();
});

type Who = { id: string; tid: string };
type Mem = { p: Who; role?: "owner" | "member"; left?: boolean; read?: number };
/** Phòng + thành viên + `n` tin (owner, bỏ qua RLS). */
async function seed(members: Mem[], n = 3, kind: "group" | "dm" = "group"): Promise<string> {
  const rid = id();
  const ks = members.map((m) => m.p.id).sort();
  await owner`insert into hub.rooms (id, tenant_id, kind, name, dm_key, last_seq, last_activity_at, created_by, created_at)
    values (${rid}, ${T.acme}, ${kind}, ${kind === "group" ? "Nhóm RV1" : null},
      ${kind === "dm" ? `${ks[0]}:${ks[1]}` : null}, ${n}, now(), ${members[0]?.p.id ?? null}, now())`;
  for (const m of members)
    await owner`insert into hub.room_members (room_id, tenant_id, user_id, role, joined_at, left_at, last_read_seq)
      values (${rid}, ${T.acme}, ${m.p.id}, ${m.role ?? "member"}, now(), ${m.left ? new Date() : null}, ${m.read ?? 0})`;
  for (let s = 1; s <= n; s++)
    await owner`insert into hub.room_messages (room_id, tenant_id, seq, sender_type, sender_id, content, created_at)
      values (${rid}, ${T.acme}, ${s}, 'user', ${members[0]?.p.id ?? null}, ${`Tin ${s}`}, now())`;
  return rid;
}
/** G: lan (chủ), hoa, tam (thành viên thường), cuc (đã bị bớt). */
const G = () =>
  seed([{ p: P.lan, role: "owner" }, { p: P.hoa }, { p: P.tam }, { p: P.cuc, left: true }]);

/** Chạy `fn` dưới GUC `who` (commit); trả mã lỗi PG hoặc "ok". Thao tác bị chặn = lỗi RLS/trigger hoặc 0 hàng ⇒ test xét trạng thái sau. */
const run = async (who: Who, fn: (tx: postgres.TransactionSql) => Promise<unknown>) => {
  try {
    await asUser(db, who, fn, { commit: true });
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
};
const room = async (rid: string) =>
  (
    await owner`select name, last_seq::int as last_seq, deleted_at from hub.rooms where id = ${rid}`
  )[0];
const mem = async (rid: string, uid: string) =>
  (
    await owner`select role, left_at, hidden_at, last_read_seq::int as last_read_seq, joined_at
      from hub.room_members where room_id = ${rid} and user_id = ${uid}`
  )[0];
const updMem = (who: Who, rid: string, target: Who, set: string) =>
  run(who, (tx) =>
    tx.unsafe(`update hub.room_members set ${set} where room_id = $1 and user_id = $2`, [
      rid,
      target.id,
    ]),
  );

describe("RV1-S01–S07 · UPDATE theo vai: thành viên thường KHÔNG làm việc của chủ [security-1 #1 · X2a-R04 · R09 · R11]", () => {
  it("HUB-BR-22 · RV1-S01 · thành viên thường đổi tên / xoá mềm phòng ⇒ DB không đổi [security-1 #1 · X2a-R04]", async () => {
    const g = await G();
    const before = await room(g);
    await run(P.hoa, (tx) => tx`update hub.rooms set name = 'Hoa đổi' where id = ${g}`);
    await run(P.hoa, (tx) => tx`update hub.rooms set deleted_at = now() where id = ${g}`);
    expect(await room(g)).toEqual(before);
  });

  it("HUB-BR-22 · RV1-S02 · không ai (kể cả chủ) UPDATE trực tiếp rooms.last_seq / last_activity_at [security-1 #1 #3 · X2a-R15]", async () => {
    const g = await G();
    for (const who of [P.hoa, P.lan]) {
      await run(who, (tx) => tx`update hub.rooms set last_seq = 0 where id = ${g}`);
      await run(who, (tx) => tx`update hub.rooms set last_seq = last_seq + 7 where id = ${g}`);
      await run(
        who,
        (tx) => tx`update hub.rooms set last_activity_at = '2000-01-01' where id = ${g}`,
      );
    }
    const [r] = await owner`select last_seq::int as n, last_activity_at > '2001-01-01' as fresh
      from hub.rooms where id = ${g}`;
    expect(r).toEqual({ n: 3, fresh: true });
  });

  it("HUB-BR-22 · RV1-S03 · thành viên thường hạ role chủ / đổi joined_at ⇒ không đổi [security-1 #1 · X2a-R11]", async () => {
    const g = await G();
    const lan = await mem(g, P.lan.id);
    const hoa = await mem(g, P.hoa.id);
    await updMem(P.hoa, g, P.lan, "role = 'member'");
    await updMem(P.hoa, g, P.lan, "joined_at = '2000-01-01'");
    await updMem(P.hoa, g, P.hoa, "joined_at = '2000-01-01'");
    expect([await mem(g, P.lan.id), await mem(g, P.hoa.id)]).toEqual([lan, hoa]);
  });

  it("HUB-BR-22 · RV1-S04 · thành viên thường đặt left_at của người khác (đá chủ / đá E) ⇒ không đổi [security-1 #1 · X2a-R04]", async () => {
    const g = await G();
    await updMem(P.hoa, g, P.lan, "left_at = now()");
    await updMem(P.hoa, g, P.tam, "left_at = now()");
    expect([(await mem(g, P.lan.id))?.left_at, (await mem(g, P.tam.id))?.left_at]).toEqual([
      null,
      null,
    ]);
  });

  it("HUB-BR-22 · RV1-S05 · thành viên thường sửa last_read_seq / hidden_at của người khác ⇒ không đổi [security-1 #1 · X2a-R07]", async () => {
    const g = await seed([
      { p: P.lan, role: "owner", read: 2 },
      { p: P.hoa },
      { p: P.tam, read: 3 },
    ]);
    await updMem(P.hoa, g, P.tam, "last_read_seq = 0");
    await updMem(P.hoa, g, P.lan, "hidden_at = now()");
    expect({
      tam: (await mem(g, P.tam.id))?.last_read_seq,
      lan: (await mem(g, P.lan.id))?.hidden_at,
    }).toEqual({ tam: 3, lan: null });
  });

  it("HUB-BR-22 · RV1-S06 · thành viên thường xoá left_at của người đã bị bớt (lách INSERT đòi chủ) ⇒ vẫn rời [security-1 #1 · X2a-R04]", async () => {
    const g = await G();
    await updMem(P.hoa, g, P.cuc, "left_at = null");
    expect((await mem(g, P.cuc.id))?.left_at).not.toBeNull();
  });

  it("HUB-BR-22 · RV1-S07 · thành viên đã rời không tự xoá left_at của chính mình [security-1 #1 · X2a-R13]", async () => {
    const g = await G();
    await updMem(P.cuc, g, P.cuc, "left_at = null");
    expect((await mem(g, P.cuc.id))?.left_at).not.toBeNull();
  });
});

describe("RV1-S08–S12 · việc được phép vẫn làm được [security-1 #1 · X2a-R04 · R07 · R09 · R10 · R12]", () => {
  it("HUB-FR-98 · RV1-S08 · chủ đổi tên, bớt người khác, xoá mềm phòng ⇒ có hiệu lực [X2a-R09 · R12]", async () => {
    const g = await G();
    expect(
      await run(P.lan, (tx) => tx`update hub.rooms set name = 'Chủ đổi' where id = ${g}`),
    ).toBe("ok");
    expect((await room(g))?.name).toBe("Chủ đổi");
    await updMem(P.lan, g, P.tam, "left_at = now()");
    expect((await mem(g, P.tam.id))?.left_at).not.toBeNull();
    await run(P.lan, async (tx) => {
      await tx`update hub.room_members set left_at = now() where room_id = ${g} and role = 'member' and left_at is null`;
      await tx`update hub.rooms set deleted_at = now() where id = ${g}`;
    });
    expect((await room(g))?.deleted_at).not.toBeNull();
  });

  it("HUB-FR-98 · RV1-S09 · thành viên thường tự đặt left_at (rời nhóm) ⇒ có hiệu lực, chỉ hàng mình [X2a-R10]", async () => {
    const g = await G();
    await updMem(P.hoa, g, P.hoa, "left_at = now()");
    expect([(await mem(g, P.hoa.id))?.left_at === null, (await mem(g, P.tam.id))?.left_at]).toEqual(
      [false, null],
    );
  });

  it("HUB-FR-100 · RV1-S10 · thành viên tự tăng last_read_seq (≤ last_seq) ⇒ ok; giảm ⇒ giữ nguyên [X2a-R03]", async () => {
    const g = await seed(
      [
        { p: P.lan, role: "owner" },
        { p: P.hoa, read: 1 },
      ],
      3,
    );
    const up = await updMem(P.hoa, g, P.hoa, "last_read_seq = 2");
    expect({ up, v: (await mem(g, P.hoa.id))?.last_read_seq }).toEqual({ up: "ok", v: 2 });
    await updMem(P.hoa, g, P.hoa, "last_read_seq = 1");
    expect((await mem(g, P.hoa.id))?.last_read_seq).toBe(2);
  });

  it("HUB-FR-100 · RV1-S11 · last_read_seq > last_seq (99) bị từ chối ⇒ giá trị không vượt last_seq [X2a-R03]", async () => {
    const g = await seed(
      [
        { p: P.lan, role: "owner" },
        { p: P.hoa, read: 1 },
      ],
      3,
    );
    await updMem(P.hoa, g, P.hoa, "last_read_seq = 99");
    expect((await mem(g, P.hoa.id))?.last_read_seq).toBeLessThanOrEqual(3);
  });

  it("HUB-FR-97 · RV1-S12 · thành viên tự đặt / bỏ hidden_at của chính mình (DM) ⇒ ok [X2a-R07]", async () => {
    const dm = await seed([{ p: P.lan }, { p: P.hoa }], 1, "dm");
    const set = await updMem(P.lan, dm, P.lan, "hidden_at = now()");
    expect({ set, hidden: (await mem(dm, P.lan.id))?.hidden_at !== null }).toEqual({
      set: "ok",
      hidden: true,
    });
    const clr = await updMem(P.lan, dm, P.lan, "hidden_at = null");
    expect({ clr, h: (await mem(dm, P.lan.id))?.hidden_at }).toEqual({ clr: "ok", h: null });
  });
});

describe("RV1-S13–S15 · seq do hệ thống cấp [security-1 #3 · X2a-R15 · AC07]", () => {
  it("HUB-BR-22 · RV1-S13 · thành viên INSERT room_messages với seq tuỳ ý (9999, last_seq+5) ⇒ bị từ chối, không có hàng [security-1 #3]", async () => {
    const g = await G();
    const ins = (seq: number) =>
      run(
        P.hoa,
        (tx) =>
          tx`insert into hub.room_messages (room_id, tenant_id, seq, sender_type, sender_id, content, created_at)
          values (${g}, ${T.acme}, ${seq}, 'user', ${P.hoa.id}, 'lén', now())`,
      );
    const [a, b] = [await ins(9999), await ins(8)];
    const rows = await owner`select seq from hub.room_messages where room_id = ${g} and seq > 3`;
    expect({ a: a !== "ok", b: b !== "ok", rows: rows.length }).toEqual({
      a: true,
      b: true,
      rows: 0,
    });
  });

  it("HUB-FR-96 · RV1-S14 · gửi qua API: 6 tin tuần tự + 6 song song ⇒ seq liền 1…12, last_seq=12 [X2a-R15 · AC07]", async () => {
    const [a, b] = [await c.tok("lan"), await c.tok("hoa")];
    const g = await mkGroup(c.hub, a, [P.hoa.id], "RV1-S14");
    const seqs: number[] = [];
    for (let i = 0; i < 6; i++) seqs.push((await say(c.hub, a, g.id, `S14-${i}`)).seq);
    const par = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        api(c.hub, i % 2 ? a : b, "POST", `/rooms/${g.id}/messages`, {
          content: `S14p-${i}`,
          client_msg_id: cm(),
        }),
      ),
    );
    expect(par.map((r) => r.status)).toEqual([201, 201, 201, 201, 201, 201]);
    seqs.push(...par.map((r) => r.json.seq as number));
    expect(seqs.sort((x, y) => x - y)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect((await room(g.id))?.last_seq).toBe(12);
  });

  it("HUB-FR-96 · RV1-S15 · thử phá phòng qua SQL (tin seq 9999 + last_seq=9998) rồi gửi API ⇒ vẫn 201 seq kế tiếp [security-1 #1 #3]", async () => {
    const [a, b] = [await c.tok("lan"), await c.tok("hoa")];
    const g = await mkGroup(c.hub, a, [P.hoa.id], "RV1-S15");
    await say(c.hub, a, g.id, "một");
    await run(
      P.hoa,
      (tx) =>
        tx`insert into hub.room_messages (room_id, tenant_id, seq, sender_type, sender_id, content, created_at)
        values (${g.id}, ${T.acme}, 9999, 'user', ${P.hoa.id}, 'lén', now())`,
    );
    await run(P.hoa, (tx) => tx`update hub.rooms set last_seq = 9998 where id = ${g.id}`);
    const r = await api(c.hub, b, "POST", `/rooms/${g.id}/messages`, {
      content: "hai",
      client_msg_id: cm(),
    });
    expect({ st: r.status, seq: r.json?.seq }).toEqual({ st: 201, seq: 2 });
  });
});

describe("RV1-S16 · room_fanout gọi thẳng SQL [security-1 #4]", () => {
  it("HUB-BR-22 · RV1-S16 · B gọi room_fanout(G): không lộ tổng chưa đọc của người khác ở phòng B không ở; số của chính B đủ [security-1 #4]", async () => {
    // E (tam) ở G (chung với hoa) và ở H (lan + tam, hoa KHÔNG ở) với 5 tin chưa đọc.
    const g = await seed([{ p: P.lan, role: "owner" }, { p: P.hoa }, { p: P.tam }], 2);
    await seed([{ p: P.lan, role: "owner" }, { p: P.tam }], 5);
    const rows = await asUser(db, P.hoa, (tx) => tx`select * from hub.room_fanout(${g})`);
    const by = Object.fromEntries(rows.map((r) => [r.user_id, r]));
    expect(Number(by[P.tam.id]?.unread)).toBe(2);
    // total của người khác không được chứa phần phòng H (hiện = 2 + 5 ⇒ lộ).
    expect(Number(by[P.tam.id]?.total ?? 0)).toBeLessThanOrEqual(2);
    expect(Number(by[P.lan.id]?.total ?? 0)).toBeLessThanOrEqual(2);
    expect(Number(by[P.hoa.id]?.unread)).toBe(2);
    expect(Number(by[P.hoa.id]?.total)).toBeGreaterThanOrEqual(2);
  });
});

describe("RV1-S17–S19 · is_tenant_user chỉ người dùng được [security-1 #8 · X2a-R02]", () => {
  it("HUB-BR-22 · RV1-S17 · hub.is_tenant_user: khoá / ngưng ⇒ false; hoạt động cùng tenant ⇒ true; tenant khác ⇒ false [security-1 #8]", async () => {
    const f = (uid: string) =>
      asUser(db, P.lan, async (tx) => (await tx`select hub.is_tenant_user(${uid}) as v`)[0]?.v);
    expect({
      khoa: await f(P.khoa.id),
      nghi: await f(P.nghi.id),
      hoa: await f(P.hoa.id),
      an: await f(P.an.id),
    }).toEqual({ khoa: false, nghi: false, hoa: true, an: false });
  });

  it("HUB-BR-22 · RV1-S18 · chủ chèn room_members cho user khoá / ngưng ⇒ 42501; user hợp lệ ⇒ ok [security-1 #8 · X2a-R02]", async () => {
    const g = await seed([{ p: P.lan, role: "owner" }], 1);
    const add = (u: Who) =>
      run(
        P.lan,
        (tx) =>
          tx`insert into hub.room_members (room_id, tenant_id, user_id, role, joined_at)
          values (${g}, ${T.acme}, ${u.id}, 'member', now())`,
      );
    expect({
      khoa: await add(P.khoa),
      nghi: await add(P.nghi),
      cuc: await add(P.cuc),
    }).toEqual({ khoa: "42501", nghi: "42501", cuc: "ok" });
  });

  it("HUB-FR-97 · RV1-S19 · hub.create_room DM tới user khoá / ngưng ⇒ P0002 (vẫn đúng sau siết) [X2a-R02]", async () => {
    const mk = (peer: string) =>
      asUser(db, P.lan, (tx) =>
        pgCode(tx`select * from hub.create_room(${id()}, 'dm', null, ${peer})`),
      );
    expect({ khoa: await mk(P.khoa.id), nghi: await mk(P.nghi.id) }).toEqual({
      khoa: "P0002",
      nghi: "P0002",
    });
  });
});

describe("RV1-H01–H04 · HTTP [security-1 #5 · review-1 #3 #4 #5]", () => {
  it("HUB-FR-100 · RV1-H01 · POST /rooms/:id/read của người vừa bị bớt / vừa rời ⇒ 404 ROOM_NOT_FOUND, last_read_seq không đổi [review-1 #5 · security-1 #5 · X2a-R03]", async () => {
    const [a, b] = [await c.tok("lan"), await c.tok("hoa")];
    const g = await mkGroup(c.hub, a, [P.hoa.id], "RV1-H01");
    await say(c.hub, a, g.id, "tin 1");
    await say(c.hub, a, g.id, "tin 2");
    expect((await api(c.hub, a, "DELETE", `/rooms/${g.id}/members/${P.hoa.id}`)).status).toBe(204);
    const r = await api(c.hub, b, "POST", `/rooms/${g.id}/read`, { seq: 2 });
    expect(codeOf(r)).toEqual({ status: 404, code: "ROOM_NOT_FOUND" });
    expect((await mem(g.id, P.hoa.id))?.last_read_seq).toBe(0);
    const g2 = await mkGroup(c.hub, a, [P.hoa.id], "RV1-H01b");
    await say(c.hub, a, g2.id, "x");
    expect((await api(c.hub, b, "POST", `/rooms/${g2.id}/leave`)).status).toBe(204);
    expect(codeOf(await api(c.hub, b, "POST", `/rooms/${g2.id}/read`, { seq: 1 }))).toEqual({
      status: 404,
      code: "ROOM_NOT_FOUND",
    });
  });

  it("HUB-FR-98 · RV1-H02 · xoá phòng song song gửi tin (12 vòng) ⇒ không tin nào có created_at > left_at của thành viên [review-1 #3 · X2a-R12 · P07]", async () => {
    const [a, b] = [await c.tok("lan"), await c.tok("hoa")];
    for (let i = 0; i < 12; i++) {
      const g = await mkGroup(c.hub, a, [P.hoa.id], `RV1-H02-${i}`);
      await say(c.hub, a, g.id, "mồi");
      const send = async () => {
        await Bun.sleep(i % 4);
        return api(c.hub, b, "POST", `/rooms/${g.id}/messages`, {
          content: `H02-${i}`,
          client_msg_id: cm(),
        });
      };
      const [del, snd] = await Promise.all([api(c.hub, a, "DELETE", `/rooms/${g.id}`), send()]);
      expect(del.status).toBe(204);
      expect([201, 404]).toContain(snd.status);
      const late = await c.sql`select m.seq from hub.room_messages m
        join hub.room_members x on x.room_id = m.room_id
        where m.room_id = ${g.id} and x.left_at is not null and m.created_at > x.left_at`;
      expect({ i, late: late.length }).toEqual({ i, late: 0 });
    }
  });

  it("HUB-FR-97 · RV1-H03 · ẩn DM song song người kia gửi (16 vòng) ⇒ không có tin mới hơn hidden_at mà DM vẫn ẩn [review-1 #4 · X2a-R07]", async () => {
    const a = await c.tok("lan");
    for (let i = 0; i < 16; i++) {
      const peer = i < 8 ? P.hoa : P.tam;
      const dm = await mkDm(c.hub, a, peer.id);
      const pt = await c.tok(i < 8 ? "hoa" : "tam");
      const [h, s] = await Promise.all([
        api(c.hub, a, "POST", `/rooms/${dm.id}/hide`),
        (async () => {
          await Bun.sleep(i % 3);
          return api(c.hub, pt, "POST", `/rooms/${dm.id}/messages`, {
            content: `H03-${i}`,
            client_msg_id: cm(),
          });
        })(),
      ]);
      expect([200, 204]).toContain(h.status);
      expect(s.status).toBe(201);
      const bad = await c.sql`select 1 from hub.room_members x where x.room_id = ${dm.id}
        and x.user_id = ${P.lan.id} and x.hidden_at is not null
        and exists (select 1 from hub.room_messages m where m.room_id = x.room_id and m.created_at > x.hidden_at)`;
      expect({ i, bad: bad.length }).toEqual({ i, bad: 0 });
    }
  });

  it("HUB-FR-98 · RV1-H04 · chủ thêm lại người đã bị bớt qua API ⇒ 200, người đó thấy phòng (đường hợp lệ vẫn chạy sau siết) [security-1 #1 · X2a-R09]", async () => {
    const [a, b] = [await c.tok("lan"), await c.tok("hoa")];
    const g = await mkGroup(c.hub, a, [P.hoa.id], "RV1-H04");
    expect((await api(c.hub, a, "DELETE", `/rooms/${g.id}/members/${P.hoa.id}`)).status).toBe(204);
    expect((await api(c.hub, b, "GET", `/rooms/${g.id}`)).status).toBe(404);
    const re = await api(c.hub, a, "POST", `/rooms/${g.id}/members`, { user_ids: [P.hoa.id] });
    expect(re.status).toBe(200);
    expect((await api(c.hub, b, "GET", `/rooms/${g.id}`)).status).toBe(200);
  });
});
