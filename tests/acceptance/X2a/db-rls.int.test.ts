// HUB-FR-96 · HUB-BR-22 · X2a-AC01 · RLS 3 bảng phòng ở mức DB thật (test-plan X2a §4 "DB thật" D01–D18; plan-db §4).
// Mỗi ca: role `hub_api` + `SET LOCAL ROLE hub_rw` + GUC `set_config(…, true)` như `withHubScope`; dữ liệu phòng chèn
// bằng SQL owner TRONG `it` (trước B1 đỏ "relation hub.rooms does not exist" trong ca, không ở `beforeAll`).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { HUB_API_URL } from "../H1/_fixtures";
import { ROOT } from "./_modules";
import { asUser, idGenX, P, pgCode, type Sql, setupX2a, T, UNKNOWN_ROOM } from "./_x2a";

let owner: Sql;
let api: Sql;
const id = idGenX(1_000);
beforeAll(async () => {
  owner = await setupX2a();
  api = postgres(HUB_API_URL, { max: 4, onnotice: () => {} });
}, 60_000);
afterAll(async () => {
  await api?.end();
  await owner?.end();
});

type Mem = {
  p: { id: string; tid: string };
  role?: "owner" | "member";
  left?: boolean;
  hidden?: boolean;
};
/** Phòng + thành viên + `n` tin (owner, bỏ qua RLS). */
async function seedRoom(o: {
  kind?: "dm" | "group";
  members: Mem[];
  n?: number;
  deleted?: boolean;
  tid?: string;
}): Promise<string> {
  const rid = id();
  const kind = o.kind ?? "group";
  const tid = o.tid ?? T.acme;
  const ids = o.members.map((m) => m.p.id).sort();
  const n = o.n ?? 2;
  await owner`insert into hub.rooms (id, tenant_id, kind, name, dm_key, last_seq, last_activity_at, created_by,
      created_at, deleted_at)
    values (${rid}, ${tid}, ${kind}, ${kind === "group" ? "Nhóm G" : null},
      ${kind === "dm" ? `${ids[0]}:${ids[1]}` : null}, ${n}, now(), ${o.members[0]?.p.id ?? null}, now(),
      ${o.deleted ? new Date() : null})`;
  await seedMembers(rid, tid, o.members, o.deleted === true);
  for (let s = 1; s <= n; s++) {
    await owner`insert into hub.room_messages (room_id, tenant_id, seq, sender_type, sender_id, content, created_at)
      values (${rid}, ${tid}, ${s}, 'user', ${o.members[0]?.p.id ?? null}, ${`Tin ${s}`}, now())`;
  }
  return rid;
}
async function seedMembers(
  rid: string,
  tid: string,
  members: Mem[],
  deleted: boolean,
): Promise<void> {
  for (const m of members) {
    await owner`insert into hub.room_members (room_id, tenant_id, user_id, role, joined_at, left_at, hidden_at,
        last_read_seq)
      values (${rid}, ${tid}, ${m.p.id}, ${m.role ?? "member"}, now(),
        ${m.left || deleted ? new Date() : null}, ${m.hidden ? new Date() : null}, 0)`;
  }
}
const G = () =>
  seedRoom({
    members: [{ p: P.lan, role: "owner" }, { p: P.hoa }, { p: P.tam }],
    n: 3,
  });

/** Số hàng thấy được của phòng trong 3 bảng. */
async function seen(who: Parameters<typeof asUser>[1], rid: string, o = {}): Promise<number[]> {
  return asUser(
    api,
    who,
    async (tx) => {
      const [a] = await tx`select count(*)::int as n from hub.rooms where id = ${rid}`;
      const [b] = await tx`select count(*)::int as n from hub.room_members where room_id = ${rid}`;
      const [c] = await tx`select count(*)::int as n from hub.room_messages where room_id = ${rid}`;
      return [a?.n, b?.n, c?.n];
    },
    o,
  );
}

describe("D01–D08 · đọc theo thành viên [X2a-AC01 · HUB-BR-22]", () => {
  it("HUB-BR-22 · D01 · không GUC / scope=system ⇒ 0 hàng 3 bảng (không nhánh system) [X2a-AC01]", async () => {
    const g = await G();
    expect(await seen(null, g)).toEqual([0, 0, 0]);
    expect(await seen(null, g, { scope: "system" })).toEqual([0, 0, 0]);
    expect(await seen(P.lan, g, { scope: "system" })).toEqual([0, 0, 0]);
  });

  it("HUB-BR-22 · D02–D05 · GUC C, tadmin, an (beta), giả mạo (tenant acme + user an) ⇒ 0 hàng; chứng thực A thấy G + mọi hàng [X2a-AC01 · AC-H23]", async () => {
    const g = await G();
    expect(await seen(P.lan, g)).toEqual([1, 3, 3]);
    expect(await seen(P.cuc, g)).toEqual([0, 0, 0]);
    expect(await seen(P.tadmin, g)).toEqual([0, 0, 0]);
    expect(await seen(P.an, g)).toEqual([0, 0, 0]);
    expect(await seen({ tid: T.acme, id: P.an.id }, g)).toEqual([0, 0, 0]);
    expect(await seen(P.padmin, g)).toEqual([0, 0, 0]);
  });

  it("HUB-BR-22 · D06 · B đã rời ⇒ 0 hàng; A vẫn thấy hàng đã rời của B [X2a-R13 · X2a-AC01]", async () => {
    const g = await seedRoom({
      members: [
        { p: P.lan, role: "owner" },
        { p: P.hoa, left: true },
      ],
      n: 2,
    });
    expect(await seen(P.hoa, g)).toEqual([0, 0, 0]);
    expect(await seen(P.lan, g)).toEqual([1, 2, 2]);
  });

  it("HUB-BR-22 · D07 · phòng xoá (deleted_at + left_at mọi người, D4) ⇒ cả chủ thấy 0 hàng [X2a-R12]", async () => {
    const g = await seedRoom({
      members: [{ p: P.lan, role: "owner" }, { p: P.hoa }],
      deleted: true,
    });
    expect(await seen(P.lan, g)).toEqual([0, 0, 0]);
    expect(await seen(P.hoa, g)).toEqual([0, 0, 0]);
  });

  it("HUB-FR-97 · D08 · A ẩn DM ⇒ GUC A vẫn thấy DM (ẩn là của app, không phải RLS) [X2a-R07]", async () => {
    const dm = await seedRoom({
      kind: "dm",
      members: [{ p: P.lan, hidden: true }, { p: P.tam }],
      n: 1,
    });
    expect(await seen(P.lan, dm)).toEqual([1, 2, 1]);
  });
});

describe("D09–D10 · không xoá/sửa tin, không INSERT rooms trực tiếp [X2a-AC01 · D3]", () => {
  it("HUB-BR-22 · D09 · thành viên UPDATE/DELETE/TRUNCATE room_messages ⇒ 42501; DELETE rooms/room_members ⇒ 42501 [X2a-R15 · X2a-AC01]", async () => {
    const g = await G();
    const one = (q: (tx: postgres.TransactionSql) => Promise<unknown>) =>
      asUser(api, P.lan, (tx) => pgCode(q(tx)));
    expect({
      upd: await one((tx) => tx`update hub.room_messages set content = 'sửa' where room_id = ${g}`),
      del: await one((tx) => tx`delete from hub.room_messages where room_id = ${g}`),
      tru: await one((tx) => tx`truncate hub.room_messages`),
      delRoom: await one((tx) => tx`delete from hub.rooms where id = ${g}`),
      delMem: await one((tx) => tx`delete from hub.room_members where room_id = ${g}`),
    }).toEqual({ upd: "42501", del: "42501", tru: "42501", delRoom: "42501", delMem: "42501" });
  });

  it("HUB-FR-96 · D10 · INSERT hub.rooms trực tiếp (GUC hợp lệ) ⇒ lỗi (không policy/GRANT INSERT) [plan D3]", async () => {
    await owner`select 1 from hub.rooms limit 1`;
    const c = await asUser(api, P.lan, (tx) =>
      pgCode(tx`insert into hub.rooms (id, tenant_id, kind, name, last_seq, last_activity_at, created_by, created_at)
        values (${id()}, ${T.acme}, 'group', 'Lén', 0, now(), ${P.lan.id}, now())`),
    );
    expect(c).toBe("42501");
  });
});

describe("D11–D12 · hub.create_room [X2a-R01 · R05 · plan-db §4.2]", () => {
  const create = (
    tx: postgres.TransactionSql,
    rid: string,
    kind: string,
    name: string | null,
    peer: string | null,
  ) => tx`select room_id, created from hub.create_room(${rid}, ${kind}, ${name}, ${peer})`;

  it("HUB-FR-97 · D11a · thiếu scope=user ⇒ 42501; dm peer = mình ⇒ 22023; peer beta/khoa/nghi/không tồn tại ⇒ P0002 [X2a-R02 · R05]", async () => {
    const noScope = await asUser(api, null, (tx) => pgCode(create(tx, id(), "group", "N", null)));
    const sys = await asUser(api, P.lan, (tx) => pgCode(create(tx, id(), "group", "N", null)), {
      scope: "system",
    });
    const self = await asUser(api, P.lan, (tx) => pgCode(create(tx, id(), "dm", null, P.lan.id)));
    const peers: Record<string, string> = {};
    for (const [k, peer] of Object.entries({
      an: P.an.id,
      khoa: P.khoa.id,
      nghi: P.nghi.id,
      unknown: UNKNOWN_ROOM,
    }))
      peers[k] = await asUser(api, P.lan, (tx) => pgCode(create(tx, id(), "dm", null, peer)));
    expect({ noScope, sys, self, peers }).toEqual({
      noScope: "42501",
      sys: "42501",
      self: "22023",
      peers: { an: "P0002", khoa: "P0002", nghi: "P0002", unknown: "P0002" },
    });
  });

  it("HUB-FR-97 · D11b · DM A→B tạo (created=true), B→A trả cùng room_id, created=false; tenant_id = GUC; 2 thành viên member [X2a-R05]", async () => {
    const rid = id();
    const first = await asUser(api, P.lan, (tx) => create(tx, rid, "dm", null, P.hoa.id), {
      commit: true,
    });
    const again = await asUser(api, P.hoa, (tx) => create(tx, id(), "dm", null, P.lan.id), {
      commit: true,
    });
    expect(first[0]).toEqual({ room_id: rid, created: true });
    expect(again[0]).toEqual({ room_id: rid, created: false });
    const [room] =
      await owner`select tenant_id, kind, name, dm_key from hub.rooms where id = ${rid}`;
    const ks = [P.lan.id, P.hoa.id].sort();
    expect(room).toEqual({
      tenant_id: T.acme,
      kind: "dm",
      name: null,
      dm_key: `${ks[0]}:${ks[1]}`,
    });
    const mem =
      await owner`select user_id, role from hub.room_members where room_id = ${rid} order by user_id`;
    expect(mem.map((m) => m.role)).toEqual(["member", "member"]);
  });

  it("HUB-FR-98 · D11c · group: người gọi là owner; hàm không có tham số tenant/user (proargnames) [X2a-R01 · R08]", async () => {
    const rid = id();
    const r = await asUser(api, P.lan, (tx) => create(tx, rid, "group", "Nhóm D11", null), {
      commit: true,
    });
    expect(r[0]).toEqual({ room_id: rid, created: true });
    const mem =
      await owner`select user_id, role, tenant_id from hub.room_members where room_id = ${rid}`;
    expect([...mem]).toEqual([{ user_id: P.lan.id, role: "owner", tenant_id: T.acme }]);
    const [f] = await owner`select coalesce(proargnames, '{}') as names from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'hub' and p.proname = 'create_room'`;
    const names = (f?.names ?? ["<thiếu create_room>"]) as string[];
    expect(names.filter((a) => /tenant|user_id|^p_user/.test(a) && a !== "room_id")).toEqual([]);
  });

  it("HUB-BR-22 · D12 · GUC tenant=beta + user=lan (user không thuộc tenant) ⇒ create_room 42501 [X2a-R01 · G5]", async () => {
    const c = await asUser(api, { tid: T.beta, id: P.lan.id }, (tx) =>
      pgCode(create(tx, id(), "group", "Giả mạo", null)),
    );
    expect(c).toBe("42501");
  });
});

describe("D13–D16 · ghi qua RLS + ràng buộc [X2a-R01 · R04 · R11 · R15]", () => {
  it("HUB-BR-22 · D13 · FK kép: thành viên/tin tenant ≠ phòng ⇒ 23503; chủ (GUC A) chèn `an` ⇒ RLS từ chối 42501 [X2a-R01]", async () => {
    const g = await G();
    const fkMem =
      await pgCode(owner`insert into hub.room_members (room_id, tenant_id, user_id, role, joined_at)
      values (${g}, ${T.beta}, ${P.an.id}, 'member', now())`);
    const fkMsg =
      await pgCode(owner`insert into hub.room_messages (room_id, tenant_id, seq, sender_type, sender_id,
        content, created_at) values (${g}, ${T.beta}, 99, 'user', ${P.an.id}, 'x', now())`);
    const rls = await asUser(api, P.lan, (tx) =>
      pgCode(tx`insert into hub.room_members (room_id, tenant_id, user_id, role, joined_at)
        values (${g}, ${T.acme}, ${P.an.id}, 'member', now())`),
    );
    const ok = await asUser(api, P.lan, (tx) =>
      pgCode(tx`insert into hub.room_members (room_id, tenant_id, user_id, role, joined_at)
        values (${g}, ${T.acme}, ${P.cuc.id}, 'member', now())`),
    );
    expect({ fkMem, fkMsg, rls, ok }).toEqual({
      fkMem: "23503",
      fkMsg: "23503",
      rls: "42501",
      ok: "ok",
    });
  });

  it("HUB-BR-22 · D14 · thành viên thường chèn room_members ⇒ 42501; tự UPDATE role='owner' ⇒ 42501 (WITH CHECK) [X2a-R04 · R09]", async () => {
    const g = await G();
    const ins = await asUser(api, P.hoa, (tx) =>
      pgCode(tx`insert into hub.room_members (room_id, tenant_id, user_id, role, joined_at)
        values (${g}, ${T.acme}, ${P.cuc.id}, 'member', now())`),
    );
    const up = await asUser(api, P.hoa, (tx) =>
      pgCode(
        tx`update hub.room_members set role = 'owner' where room_id = ${g} and user_id = ${P.hoa.id}`,
      ),
    );
    expect({ ins, up }).toEqual({ ins: "42501", up: "42501" });
  });

  it("HUB-BR-22 · D15 · tin: sender_id ≠ GUC user ⇒ 42501; sender_type='agent' ⇒ 42501; GUC C chèn vào G ⇒ 42501; A đúng ⇒ ok [X2a-R15]", async () => {
    const g = await G();
    // Sau review-1 (security-1 #3) policy chỉ nhận seq = last_seq ⇒ đặt last_seq=10 (owner) để ca "đúng" chèn seq 10.
    await owner`update hub.rooms set last_seq = 10 where id = ${g}`;
    const ins = (who: typeof P.lan, sender: string, type = "user", seq = 10) =>
      asUser(api, who, (tx) =>
        pgCode(tx`insert into hub.room_messages (room_id, tenant_id, seq, sender_type, sender_id, content, created_at)
          values (${g}, ${T.acme}, ${seq}, ${type}, ${sender}, 'x', now())`),
      );
    expect({
      spoof: await ins(P.lan, P.hoa.id),
      agent: await ins(P.lan, P.lan.id, "agent"),
      outsider: await ins(P.cuc, P.cuc.id),
      ok: await ins(P.lan, P.lan.id),
    }).toEqual({ spoof: "42501", agent: "42501", outsider: "42501", ok: "ok" });
  });

  it("HUB-FR-98 · D16 · ràng buộc: 2 owner hoạt động ⇒ 23P01 lúc COMMIT; dm có name / nhóm tên 81 / content 16001 / seq 0 ⇒ 23514; (room_id, seq) trùng ⇒ 23505 [X2a-R11 · R08 · R15]", async () => {
    const g = await G();
    const twoOwners = await pgCode(
      owner.begin(async (tx) => {
        await tx`update hub.room_members set role = 'owner' where room_id = ${g} and user_id = ${P.hoa.id}`;
      }),
    );
    const transfer = await pgCode(
      owner.begin(async (tx) => {
        await tx`update hub.room_members set role = case user_id when ${P.hoa.id}::uuid then 'owner' else 'member' end
          where room_id = ${g} and user_id in (${P.lan.id}, ${P.hoa.id})`;
      }),
    );
    const room = (kind: string, name: string | null, dm: string | null) =>
      pgCode(owner`insert into hub.rooms (id, tenant_id, kind, name, dm_key, last_seq, last_activity_at, created_by,
          created_at) values (${id()}, ${T.acme}, ${kind}, ${name}, ${dm}, 0, now(), ${P.lan.id}, now())`);
    const msg = (seq: number, content: string) =>
      pgCode(owner`insert into hub.room_messages (room_id, tenant_id, seq, sender_type, sender_id, content, created_at)
        values (${g}, ${T.acme}, ${seq}, 'user', ${P.lan.id}, ${content}, now())`);
    expect({
      twoOwners,
      transfer,
      dmName: await room("dm", "Tên", "a:b"),
      name81: await room("group", "a".repeat(81), null),
      content: await msg(50, "a".repeat(16_001)),
      seq0: await msg(0, "x"),
      dup: await msg(1, "trùng"),
    }).toEqual({
      twoOwners: "23P01",
      transfer: "ok",
      dmName: "23514",
      name81: "23514",
      content: "23514",
      seq0: "23514",
      dup: "23505",
    });
  });
});

describe("D17–D18 · hàm definer, quyền role khác, idempotent [X2a-AC01 · plan §12]", () => {
  it("HUB-BR-22 · D17a · room_fanout(G) với GUC C ⇒ 0 hàng; GUC A ⇒ 3 hàng; is_room_member scope system ⇒ false [X2a-R20]", async () => {
    const g = await G();
    const c = await asUser(api, P.cuc, (tx) => tx`select * from hub.room_fanout(${g})`);
    const a = await asUser(api, P.lan, (tx) => tx`select * from hub.room_fanout(${g})`);
    const sys = await asUser(api, P.lan, (tx) => tx`select hub.is_room_member(${g}) as m`, {
      scope: "system",
    });
    expect({ c: c.length, a: a.length, sys: sys[0]?.m }).toEqual({ c: 0, a: 3, sys: false });
  });

  it("HUB-BR-22 · D17b · admin_rw/agent_runtime không SELECT 3 bảng; 5 hàm definer có search_path cố định, không EXECUTE cho PUBLIC [plan §12.1]", async () => {
    const tables = ["hub.rooms", "hub.room_members", "hub.room_messages"];
    const privs: Record<string, boolean> = {};
    for (const role of ["admin_rw", "agent_runtime"])
      for (const t of tables) {
        const [r] = await owner`select has_table_privilege(${role}, ${t}, 'SELECT') as ok`;
        privs[`${role} ${t}`] = r?.ok;
      }
    expect(Object.values(privs).every((v) => v === false)).toBe(true);
    const fns = await owner`select p.proname, p.prosecdef, p.proconfig,
        has_function_privilege('public', p.oid, 'EXECUTE') as pub,
        has_function_privilege('hub_rw', p.oid, 'EXECUTE') as rw
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'hub' and p.proname in ('is_room_member', 'is_room_owner', 'is_tenant_user',
        'create_room', 'room_fanout') order by p.proname`;
    expect(fns.map((f) => f.proname)).toEqual([
      "create_room",
      "is_room_member",
      "is_room_owner",
      "is_tenant_user",
      "room_fanout",
    ]);
    for (const f of fns) {
      expect({ n: f.proname, def: f.prosecdef, pub: f.pub, rw: f.rw }).toEqual({
        n: f.proname,
        def: true,
        pub: false,
        rw: true,
      });
      expect((f.proconfig ?? []).some((c: string) => c.startsWith("search_path="))).toBe(true);
    }
  });

  it("HUB-FR-96 · D18 · chạy lại 0011_x2a_rooms.sql lần 2 không lỗi (idempotent) [plan-db §4]", async () => {
    const file = join(ROOT, "packages/db/migrations-hub/0011_x2a_rooms.sql");
    const text = readFileSync(file, "utf8");
    for (const stmt of text.split("--> statement-breakpoint")) {
      if (stmt.trim()) await owner.unsafe(stmt);
    }
    const [r] = await owner`select count(*)::int as n from pg_policies where schemaname = 'hub'
      and tablename in ('rooms', 'room_members', 'room_messages')`;
    expect(r?.n).toBe(7);
  });
});
