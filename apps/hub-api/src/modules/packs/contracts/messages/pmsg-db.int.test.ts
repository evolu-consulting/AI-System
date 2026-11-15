// CR-169 · lát 2a · spec §3 (P1–P7, P13, P14) · §5 (hub 0149) · Tin nhắn 1–1 giữa nhân viên hai công ty đã kết nối, ở tầng DB.
// Role thật `hub_api` (scope user). Người dùng KHÔNG là tham số hàm: mọi hàm đọc `app.user_id` ⇒ không ai đứng tên thay người khác.
// Công ty: A (NitiGroup) — B (Preschool) đã kết nối; C kết nối với A, KHÔNG với B (công ty thứ ba); E không quan hệ.
// N2: Vy (nhân viên, KHÔNG phải người mời kết nối — Tiên mời) mở cuộc với Hà (nhân viên B, không phải người đồng ý — Dung đồng ý).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { enablePack, members, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, inHub, openOwner, type Sql } from "@ai/test-kit/db";

const A = tenantId(1690);
const B = tenantId(1691);
const C = tenantId(1692);
const E = tenantId(1693);
const TIEN = userId(1690); // A · Toàn quyền (người mời)
const VY = userId(1691); // A · nhân viên (editor)
const LAN = userId(1692); // A · nhân viên (viewer), ngoài cuộc Vy–Hà
const NOGRANT = userId(1693); // A · không có quyền gói contracts
const DUNG = userId(1694); // B · Toàn quyền (người đồng ý)
const HA = userId(1695); // B · nhân viên (viewer)
const HB = userId(1696); // B · nhân viên (viewer), sẽ bị khoá ở ca «người kia không còn hợp lệ»
const EXT = userId(1697); // B · user external (DB đã cấm vào Group; hàm vẫn chặn theo kind)
const CUONG = userId(1698); // C · Toàn quyền
const EVA = userId(1699); // E · Toàn quyền
const ORG = "a1690000-0000-4000-8000-000000000001";
let o: Sql;

const as = <T>(t: string, u: string, fn: (tx: Sql) => Promise<T>) =>
  inHub({ kind: "user", tenantId: t, userId: u }, fn);
type Fail = { code: string | null; message: string };
const fail = async (fn: () => Promise<unknown>): Promise<Fail> => {
  try {
    await fn();
    return { code: null, message: "" };
  } catch (e) {
    return { code: (e as { code?: string }).code ?? null, message: (e as Error).message };
  }
};
type Msg = {
  id: string;
  seq: number;
  conversation_id: string;
  sender_id: string;
  body: string;
  files: unknown[];
  deleted: boolean;
};
type Sent = {
  seq: string;
  created: boolean;
  message: Msg;
  notify: { tenant_id: string; user_id: string }[];
};
type Row = {
  id: string;
  peer_user: string;
  peer_name: string;
  peer_title: string | null;
  peer_active: boolean;
  company_id: string;
  company_name: string;
  last: { seq: number; preview: string; deleted: boolean; sender_id: string } | null;
  unread: number;
  last_at: Date;
  read_only: boolean;
  my_read_seq?: string;
  peer_read_seq?: string;
};

const invite = (tx: Sql, to: string, user: string) =>
  tx`select hub.cc_invite(${to}::uuid, null, ${user}::uuid, 'Mời') as s`.then(
    (r) => r[0]?.s as string,
  );
const accept = (tx: Sql, from: string) =>
  tx`select hub.partner_link_accept(${from}::uuid) as ok`.then((r) => r[0]?.ok as boolean);
const open = (tx: Sql, tenant: string, user: string) =>
  tx<
    { id: string; created: boolean }[]
  >`select * from hub.pmsg_open(${tenant}::uuid, ${user}::uuid)`.then((r) => r[0]);
const send = (
  tx: Sql,
  id: string,
  body: string,
  cid: string = randomUUID(),
  files: string[] = [],
) =>
  tx<Sent[]>`select * from hub.pmsg_send(${id}::uuid, ${cid}::uuid, ${body},
    array(select x::uuid from jsonb_array_elements_text(${JSON.stringify(files)}::text::jsonb) x))`.then(
    (r) => r[0] as Sent,
  );
const page = (tx: Sql, id: string, before: number | null = null, limit = 50) =>
  tx<
    { items: Msg[]; has_more: boolean }[]
  >`select * from hub.pmsg_page(${id}::uuid, ${before}::bigint, ${limit}::int)`.then(
    (r) => r[0] as { items: Msg[]; has_more: boolean },
  );
const inbox = (
  tx: Sql,
  company: string | null = null,
  cur: { t: Date; id: string } | null = null,
  limit = 30,
) =>
  tx<
    Row[]
  >`select * from hub.pmsg_inbox(${company}::uuid, ${cur?.t ?? null}::timestamptz, ${cur?.id ?? null}::uuid, ${limit}::int)`;
const detail = (tx: Sql, id: string) =>
  tx<Row[]>`select * from hub.pmsg_detail(${id}::uuid)`.then((r) => r[0] as Row);
const markRead = (tx: Sql, id: string, seq: number) =>
  tx`select hub.pmsg_mark_read(${id}::uuid, ${seq}::bigint) as n`.then((r) => Number(r[0]?.n));
const unread = (tx: Sql) => tx`select hub.pmsg_unread() as n`.then((r) => Number(r[0]?.n));
const del = (tx: Sql, id: string, seq: number) =>
  tx<{ b: string[] }[]>`select hub.pmsg_delete(${id}::uuid, ${seq}::bigint) as b`.then(
    (r) => r[0]?.b as string[],
  );
/** Tệp đã tải (hàm tải tệp là lát 2b) — dựng bằng owner, đúng ràng buộc bảng. */
async function addFile(tenant: string, user: string, thread: string): Promise<string> {
  const id = randomUUID();
  await o`insert into hub.pmsg_files (id, thread_id, tenant_id, user_id, name, mime, size, storage_key, box_file_id)
    values (${id}, ${thread}, ${tenant}, ${user}, 'bao-gia.pdf', 'application/pdf', 1234, ${`${tenant}/${id}`}, ${`bx${id.slice(0, 8)}`})`;
  return id;
}

let vyHa = ""; // cuộc Vy (A) – Hà (B)
let allocated = 0;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  await o`insert into admin.tenants (id, key, name, legal_name, tax_code, directory_listed)
    values (${A}, 'pm-a', 'A', 'NitiGroup', '0100000301', true), (${B}, 'pm-b', 'B', 'Preschool Việt', '0100000302', true),
           (${C}, 'pm-c', 'C', 'Công ty Cờ', '0100000303', true), (${E}, 'pm-e', 'E', 'Công ty Ê', '0100000304', true)`;
  await users(o, A, 4, { from: 1690 }); // Tiên, Vy, Lan, NoGrant
  await users(o, B, 3, { from: 1694 }); // Dung, Hà, Hb (Ext là user external, tạo bên dưới)
  await users(o, C, 1, { from: 1698 });
  await users(o, E, 1, { from: 1699 });
  await o`insert into admin.external_orgs (id, tenant_id, name) values (${ORG}, ${B}, 'NCC Ngoài')`;
  await o`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, kind, external_org_id, must_change_password)
    values (${EXT}, ${B}, 'ncc-ext', 'x', 'NCC', 'member', 'external', ${ORG}, false)`;
  const g = await enablePack(o, [A, B, C, E], "contracts");
  await members(o, A, g.get(A)?.owner as string, [TIEN]);
  await members(o, A, g.get(A)?.editor as string, [VY]);
  await members(o, A, g.get(A)?.viewer as string, [LAN]);
  await members(o, B, g.get(B)?.owner as string, [DUNG]);
  await members(o, B, g.get(B)?.viewer as string, [HA, HB]);
  await members(o, C, g.get(C)?.owner as string, [CUONG]);
  await members(o, E, g.get(E)?.owner as string, [EVA]);
  await o`insert into hub.people_profiles (tenant_id, user_id, job_title) values (${B}, ${HA}, 'Kế toán trưởng')`;
  // A–B và A–C đã kết nối (Tiên mời — Dung/Cường đồng ý).
  expect(await as(A, TIEN, (tx) => invite(tx, B, TIEN))).toBe("pending_out");
  expect(await as(B, DUNG, (tx) => accept(tx, A))).toBe(true);
  expect(await as(A, TIEN, (tx) => invite(tx, C, TIEN))).toBe("pending_out");
  expect(await as(C, CUONG, (tx) => accept(tx, A))).toBe(true);
}, 90_000);
afterAll(async () => {
  await o?.end({ timeout: 2 });
});

describe("CR-169 · P1 chỉ người hợp lệ, user từ app.user_id (không giả danh)", () => {
  it("thiếu app.user_id, sai tenant/user, không có quyền gói, external ⇒ 42501 ở mọi hàm", async () => {
    const calls: [string, (tx: Sql) => Promise<unknown>][] = [
      ["inbox", (tx) => inbox(tx)],
      ["unread", (tx) => unread(tx)],
      ["open", (tx) => open(tx, B, HA)],
      ["detail", (tx) => detail(tx, randomUUID())],
      ["send", (tx) => send(tx, randomUUID(), "x")],
    ];
    const actors: [string, string, string][] = [
      ["không đặt user_id", A, ""],
      ["user của công ty khác (giả danh)", B, VY],
      ["không có quyền gói", A, NOGRANT],
      ["external", B, EXT],
    ];
    for (const [who, t, u] of actors) {
      for (const [name, fn] of calls) {
        const f = await fail(() => as(t, u, fn));
        expect([who, name, f.code]).toEqual([who, name, "42501"]);
      }
    }
  });
  it("bảng không đọc/ghi được trực tiếp ở scope người dùng (RLS system), hàm nội bộ không gọi được", async () => {
    await as(A, VY, async (tx) => {
      const r = await open(tx, B, HA);
      expect(r?.created).toBe(true);
    });
    const rows = await as(A, VY, (tx) => tx`select count(*)::int as n from hub.pmsg_threads`);
    expect(rows[0]?.n).toBe(0);
    const ins = await fail(() =>
      as(
        A,
        VY,
        (tx) =>
          tx`insert into hub.pmsg_messages (thread_id, seq, sender_user, client_id) values (${randomUUID()}, 1, ${VY}, ${randomUUID()})`,
      ),
    );
    expect(ins.code).toBe("42501");
    for (const fn of ["hub.pmsg_ctx()", "hub.pmsg_eligible_raw(uuid, uuid)"]) {
      const f = await fail(() =>
        as(A, VY, (tx) =>
          tx.unsafe(`select ${fn.replace("(uuid, uuid)", `('${A}'::uuid, '${VY}'::uuid)`)}`),
        ),
      );
      expect([fn, f.code]).toEqual([fn, "42501"]);
    }
  });
});

describe("CR-169 · P2 mở 1–1 (N2: Vy ≠ người mời kết nối)", () => {
  it("cùng công ty ⇒ MSG_USER_INVALID · không kết nối ⇒ MSG_NOT_CONNECTED · người kia không hợp lệ ⇒ MSG_USER_INVALID", async () => {
    const same = await fail(() => as(A, VY, (tx) => open(tx, A, LAN)));
    expect([same.code, same.message]).toEqual(["CC422", "MSG_USER_INVALID"]);
    const notConn = await fail(() => as(A, VY, (tx) => open(tx, E, EVA)));
    expect([notConn.code, notConn.message]).toEqual(["CC409", "MSG_NOT_CONNECTED"]);
    const thirdToB = await fail(() => as(C, CUONG, (tx) => open(tx, B, HA)));
    expect([thirdToB.code, thirdToB.message]).toEqual(["CC409", "MSG_NOT_CONNECTED"]);
    for (const bad of [EXT, NOGRANT, userId(1)]) {
      const f = await fail(() => as(A, VY, (tx) => open(tx, B, bad)));
      expect([bad, f.code, f.message]).toEqual([bad, "CC422", "MSG_USER_INVALID"]);
    }
    const wrongTenant = await fail(() => as(A, VY, (tx) => open(tx, B, LAN))); // LAN thuộc A, không thuộc B
    expect(wrongTenant.message).toBe("MSG_USER_INVALID");
  });
  it("tạo mới rồi mở lại từ MỖI đầu đều ra đúng một cuộc; không chèn tin", async () => {
    const first = await as(A, VY, (tx) => open(tx, B, HA));
    expect(first?.created).toBe(false); // đã tạo ở ca RLS phía trên
    vyHa = first?.id as string;
    const fromHa = await as(B, HA, (tx) => open(tx, A, VY));
    expect(fromHa).toEqual({ id: vyHa, created: false });
    const [n] =
      await o`select (select count(*)::int from hub.pmsg_threads where id = ${vyHa}) as t, (select count(*)::int from hub.pmsg_messages where thread_id = ${vyHa}) as m`;
    expect([n?.t, n?.m]).toEqual([1, 0]);
    const [th] =
      await o`select a_tenant, a_user, b_tenant, b_user from hub.pmsg_threads where id = ${vyHa}`;
    const lo = `${A}${VY}` < `${B}${HA}`;
    expect([th?.a_tenant, th?.a_user]).toEqual(lo ? [A, VY] : [B, HA]); // (tenant,user) nhỏ hơn đứng đầu a
    const dbl = await Promise.all([
      as(A, TIEN, (tx) => open(tx, B, DUNG)),
      as(B, DUNG, (tx) => open(tx, A, TIEN)),
    ]);
    expect(dbl[0]?.id).toBe(dbl[1]?.id); // đua mở cùng lúc ⇒ một cuộc
    expect(dbl.filter((d) => d?.created).length).toBe(1);
  });
});

describe("CR-169 · P3 chỉ hai đầu thấy; người ngoài cuộc, công ty thứ ba ⇒ MSG_NOT_FOUND", () => {
  it("Lan (cùng công ty Vy), Dung (cùng công ty Hà), Cường (công ty thứ ba) không đọc/ghi được cuộc Vy–Hà", async () => {
    await as(A, VY, (tx) => send(tx, vyHa, "Chào Hà"));
    const strangers: [string, string][] = [
      [A, LAN],
      [B, DUNG],
      [C, CUONG],
      [A, TIEN],
    ];
    for (const [t, u] of strangers) {
      const ops: [string, (tx: Sql) => Promise<unknown>][] = [
        ["detail", (tx) => detail(tx, vyHa)],
        ["page", (tx) => page(tx, vyHa)],
        ["send", (tx) => send(tx, vyHa, "chen ngang")],
        ["mark_read", (tx) => markRead(tx, vyHa, 99)],
        ["delete", (tx) => del(tx, vyHa, 1)],
      ];
      for (const [name, fn] of ops) {
        const f = await fail(() => as(t, u, fn));
        expect([u, name, f.code, f.message]).toEqual([u, name, "CC404", "MSG_NOT_FOUND"]);
      }
      expect((await as(t, u, (tx) => inbox(tx))).some((r) => r.id === vyHa)).toBe(false);
    }
    const [n] = await o`select count(*)::int as n from hub.pmsg_messages where thread_id = ${vyHa}`;
    expect(n?.n).toBe(1); // không tin nào bị chèn/xoá
  });
});

describe("CR-169 · P4 gửi, P6 đã đọc, chưa đọc", () => {
  it("gửi lặp cùng client_id ⇒ tin cũ, không tăng seq, notify rỗng; hai đầu nhận notify khi tạo mới", async () => {
    const cid = randomUUID();
    const s1 = await as(B, HA, (tx) => send(tx, vyHa, "Chào Vy", cid));
    expect([s1.created, Number(s1.seq)]).toEqual([true, 2]);
    expect(s1.notify.map((n) => n.user_id).sort()).toEqual([HA, VY].sort());
    const s2 = await as(B, HA, (tx) => send(tx, vyHa, "(gửi lại)", cid));
    expect([s2.created, Number(s2.seq), s2.message.body, s2.notify]).toEqual([
      false,
      2,
      "Chào Vy",
      [],
    ]);
    const [r] = await o`select last_seq from hub.pmsg_threads where id = ${vyHa}`;
    expect(Number(r?.last_seq)).toBe(2);
  });
  it("đua: hai tx cùng client_id ⇒ một tin; nhiều người gửi cùng lúc ⇒ seq liên tục không trùng", async () => {
    const cid = randomUUID();
    const dup = await Promise.all([1, 2].map(() => as(A, VY, (tx) => send(tx, vyHa, "đua", cid))));
    expect(dup.filter((d) => d.created).length).toBe(1);
    expect(dup[0]?.seq).toBe(dup[1]?.seq);
    const many = await Promise.all(
      [0, 1, 2, 3, 4, 5].map((i) =>
        i % 2
          ? as(A, VY, (tx) => send(tx, vyHa, `v${i}`))
          : as(B, HA, (tx) => send(tx, vyHa, `h${i}`)),
      ),
    );
    const seqs = [...many.map((m) => Number(m.seq)), Number(dup[0]?.seq)].sort((a, b) => a - b);
    expect(seqs).toEqual([3, 4, 5, 6, 7, 8, 9]);
    allocated = 9;
  });
  it("thân rỗng/quá dài/quá nhiều tệp/tệp không phải của mình ⇒ lỗi; thân rỗng nhưng có tệp ⇒ được", async () => {
    const e = await fail(() => as(A, VY, (tx) => send(tx, vyHa, "  \n ")));
    expect([e.code, e.message]).toEqual(["CC400", "MSG_EMPTY"]);
    const long = await fail(() => as(A, VY, (tx) => send(tx, vyHa, "x".repeat(4001))));
    expect(long.message).toBe("MSG_TOO_LONG");
    const many = await fail(() =>
      as(A, VY, (tx) =>
        send(
          tx,
          vyHa,
          "x",
          randomUUID(),
          Array.from({ length: 11 }, () => randomUUID()),
        ),
      ),
    );
    expect(many.message).toBe("MSG_TOO_MANY_FILES");
    const fVy = await addFile(A, VY, vyHa);
    const fHa = await addFile(B, HA, vyHa);
    const alien = await fail(() =>
      as(A, VY, (tx) => send(tx, vyHa, "tệp của Hà", randomUUID(), [fHa])),
    );
    expect([alien.code, alien.message]).toEqual(["CC422", "MSG_FILE_INVALID"]);
    const dupIds = await fail(() =>
      as(A, VY, (tx) => send(tx, vyHa, "trùng", randomUUID(), [fVy, fVy])),
    );
    expect(dupIds.message).toBe("MSG_FILE_INVALID");
    const ok = await as(A, VY, (tx) => send(tx, vyHa, "", randomUUID(), [fVy]));
    expect(ok.message.files).toEqual([
      { id: fVy, name: "bao-gia.pdf", mime: "application/pdf", size: 1234 },
    ]);
    allocated = Number(ok.seq);
    const reused = await fail(() =>
      as(A, VY, (tx) => send(tx, vyHa, "dùng lại tệp đã gắn", randomUUID(), [fVy])),
    );
    expect(reused.message).toBe("MSG_FILE_INVALID");
  });
  it("chưa đọc theo người, mốc chỉ tiến và kẹp ≤ last_seq, «Đã xem» = mốc đầu kia", async () => {
    const before = await as(B, HA, (tx) => detail(tx, vyHa));
    expect(before.unread).toBeGreaterThan(0);
    expect(before.company_name).toBe("NitiGroup");
    expect([before.peer_name, before.peer_active, before.read_only]).toEqual([
      "User 1691",
      true,
      false,
    ]);
    expect(await as(B, HA, (tx) => unread(tx))).toBe(before.unread);
    expect(await as(B, HA, (tx) => markRead(tx, vyHa, 99999))).toBe(allocated); // kẹp last_seq
    expect(await as(B, HA, (tx) => markRead(tx, vyHa, 1))).toBe(allocated); // không lùi
    expect(await as(B, HA, (tx) => unread(tx))).toBe(0);
    const vy = await as(A, VY, (tx) => detail(tx, vyHa));
    expect(Number(vy.peer_read_seq)).toBe(allocated);
    expect(Number(vy.my_read_seq)).toBe(allocated); // người gửi tiến mốc tới tin của mình ⇒ tin Hà trước đó coi như đã đọc
    expect(vy.unread).toBe(0);
  });
  it("trang tin: seq giảm dần, has_more, trước mốc", async () => {
    const p1 = await as(A, VY, (tx) => page(tx, vyHa, null, 4));
    expect(p1.items.map((m) => m.seq)).toEqual([
      allocated,
      allocated - 1,
      allocated - 2,
      allocated - 3,
    ]);
    expect(p1.has_more).toBe(true);
    const p2 = await as(B, HA, (tx) => page(tx, vyHa, allocated - 3, 100));
    expect(p2.items.length).toBe(allocated - 4);
    expect(p2.has_more).toBe(false);
  });
});

describe("CR-169 · P5 thu hồi", () => {
  it("chỉ người gửi; xoá nội dung + tệp (trả id FileBox), không tính chưa đọc; lặp lại ⇒ rỗng; không có tin ⇒ 404", async () => {
    const f = await addFile(A, VY, vyHa);
    const sent = await as(A, VY, (tx) => send(tx, vyHa, "báo giá nhầm", randomUUID(), [f]));
    const seq = Number(sent.seq);
    const wrong = await fail(() => as(B, HA, (tx) => del(tx, vyHa, seq)));
    expect([wrong.code, wrong.message]).toEqual(["CC403", "MSG_NOT_SENDER"]);
    expect(await as(B, HA, (tx) => unread(tx))).toBe(1);
    const box = await as(A, VY, (tx) => del(tx, vyHa, seq));
    expect(box.length).toBe(1);
    expect(await as(A, VY, (tx) => del(tx, vyHa, seq))).toEqual([]);
    expect(await as(B, HA, (tx) => unread(tx))).toBe(0); // thu hồi tin chưa đọc ⇒ số giảm
    const m = (await as(B, HA, (tx) => page(tx, vyHa, null, 1))).items[0] as Msg;
    expect([m.deleted, m.body, m.files]).toEqual([true, "", []]);
    const [fr] = await o`select deleted_at is not null as d from hub.pmsg_files where id = ${f}`;
    expect(fr?.d).toBe(true);
    const nf = await fail(() => as(A, VY, (tx) => del(tx, vyHa, 9999)));
    expect(nf.code).toBe("CC404");
    allocated = seq;
  });
});

describe("CR-169 · danh sách cuộc (P9): lọc công ty, keyset, tên/chức vụ/công ty", () => {
  it("Vy có cuộc với Hà (B) và Cường (C): mặc định cả hai, lọc theo công ty; phân trang con trỏ không lặp/sót", async () => {
    const withC = (await as(A, VY, (tx) => open(tx, C, CUONG))) as { id: string };
    await as(C, CUONG, (tx) => send(tx, withC.id, "Chào anh Vy"));
    const all = await as(A, VY, (tx) => inbox(tx));
    expect(all.map((r) => r.id)).toEqual([withC.id, vyHa]); // gần đây trước
    const rHa = all.find((r) => r.id === vyHa) as Row;
    expect([rHa.peer_name, rHa.peer_title, rHa.company_name, rHa.company_id]).toEqual([
      "User 1695",
      "Kế toán trưởng",
      "Preschool Việt",
      B,
    ]);
    expect(rHa.last?.deleted).toBe(true);
    expect((await as(A, VY, (tx) => inbox(tx, B))).map((r) => r.id)).toEqual([vyHa]);
    expect((await as(A, VY, (tx) => inbox(tx, C))).map((r) => r.id)).toEqual([withC.id]);
    expect(await as(A, VY, (tx) => inbox(tx, E))).toEqual([]);
    const p1 = await as(A, VY, (tx) => inbox(tx, null, null, 1));
    expect(p1.map((r) => r.id)).toEqual([withC.id]);
    const p2 = await as(A, VY, (tx) =>
      inbox(tx, null, { t: (p1[0] as Row).last_at, id: withC.id }, 1),
    );
    expect(p2.map((r) => r.id)).toEqual([vyHa]);
    expect(await as(A, VY, (tx) => unread(tx))).toBe(1); // tin của Cường
    expect(await as(C, CUONG, (tx) => inbox(tx))).toHaveLength(1); // Cường chỉ thấy cuộc của mình
  });
});

describe("CR-169 · P7 chỉ đọc sau ngắt; nối lại dùng cuộc cũ; người kia không còn hợp lệ", () => {
  it("Tiên ngắt A–B ⇒ gửi 409 MSG_NOT_CONNECTED, vẫn đọc/đánh dấu đọc/thu hồi được, read_only; mời lại + đồng ý ⇒ cuộc cũ", async () => {
    const last = await as(A, VY, (tx) => send(tx, vyHa, "tin cuối trước khi ngắt"));
    expect(
      await as(A, TIEN, (tx) =>
        tx`select hub.cc_disconnect(${B}::uuid) as ok`.then((r) => r[0]?.ok),
      ),
    ).toBe(true);
    for (const [t, u] of [
      [A, VY],
      [B, HA],
    ] as const) {
      const s = await fail(() => as(t, u, (tx) => send(tx, vyHa, "sau ngắt")));
      expect([u, s.code, s.message]).toEqual([u, "CC409", "MSG_NOT_CONNECTED"]);
      const d = await as(t, u, (tx) => detail(tx, vyHa));
      expect(d.read_only).toBe(true);
      expect((await as(t, u, (tx) => page(tx, vyHa))).items.length).toBeGreaterThan(5);
    }
    expect(await as(B, HA, (tx) => markRead(tx, vyHa, Number(last.seq)))).toBe(Number(last.seq));
    expect((await as(A, VY, (tx) => inbox(tx, B))).map((r) => r.id)).toEqual([vyHa]); // vẫn trong danh sách lọc theo công ty
    const op = await fail(() => as(A, VY, (tx) => open(tx, B, HA)));
    expect(op.message).toBe("MSG_NOT_CONNECTED");
    expect(await as(A, VY, (tx) => del(tx, vyHa, Number(last.seq)))).toEqual([]); // thu hồi mọi lúc, kể cả sau ngắt (tin không có tệp)
    expect(((await as(B, HA, (tx) => page(tx, vyHa, null, 1))).items[0] as Msg).deleted).toBe(true);
    expect(await as(A, TIEN, (tx) => invite(tx, B, TIEN))).toBe("pending_out");
    expect(await as(B, DUNG, (tx) => accept(tx, A))).toBe(true);
    expect(await as(A, VY, (tx) => open(tx, B, HA))).toEqual({ id: vyHa, created: false });
    expect((await as(A, VY, (tx) => detail(tx, vyHa))).read_only).toBe(false);
    expect((await as(A, VY, (tx) => send(tx, vyHa, "nối lại"))).created).toBe(true);
  });
  it("người kia bị khoá ⇒ gửi 409 MSG_PEER_INACTIVE, read_only + peer_active=false; mở khoá ⇒ gửi lại được", async () => {
    const c = (await as(A, LAN, (tx) => open(tx, B, HB))) as { id: string };
    await as(A, LAN, (tx) => send(tx, c.id, "Chào Hb"));
    await o`update admin.users set locked_by_tenant = true where id = ${HB}`;
    const s = await fail(() => as(A, LAN, (tx) => send(tx, c.id, "còn đó không")));
    expect([s.code, s.message]).toEqual(["CC409", "MSG_PEER_INACTIVE"]);
    const d = await as(A, LAN, (tx) => detail(tx, c.id));
    expect([d.read_only, d.peer_active]).toEqual([true, false]);
    const hb = await fail(() => as(B, HB, (tx) => inbox(tx))); // người bị khoá không dùng được nữa
    expect(hb.code).toBe("42501");
    await o`update admin.users set locked_by_tenant = false where id = ${HB}`;
    expect((await as(A, LAN, (tx) => send(tx, c.id, "đã mở khoá"))).created).toBe(true);
    // Lan bị gỡ khỏi Group (mất quyền đọc gói) ⇒ không dùng được nữa (P1), dữ liệu cuộc cũ không mất.
    await o`delete from admin.group_members where user_id = ${LAN}`;
    expect((await fail(() => as(A, LAN, (tx) => inbox(tx)))).code).toBe("42501");
  });
});

describe("CR-169 · chạy lại migration 0149 + cc_* đã gỡ", () => {
  it("cc_links không còn cột unread; hàm/bảng cc trò chuyện đã gỡ; chạy lại 0149 giữ dữ liệu, quyền, xoá chuông cc.msg", async () => {
    const links = await as(A, TIEN, (tx) => tx`select * from hub.cc_links(null, null, null, 10)`);
    expect(links.length).toBeGreaterThan(0);
    expect(Object.keys(links[0] ?? {})).not.toContain("unread");
    const [gone] =
      await o`select count(*)::int as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'hub' and p.proname in ('cc_thread_page','cc_send','cc_mark_read','cc_file_add','cc_file_get','cc_unread','cc_files_sweep','cc_thread_ensure','cc_msg_json','cc_ctx')`;
    const [tbl] =
      await o`select count(*)::int as n from information_schema.tables where table_schema = 'hub' and table_name like 'cc\\_%'`;
    expect([gone?.n, tbl?.n]).toEqual([0, 0]);
    await o`insert into hub.notifications (tenant_id, user_id, source, kind, title, body, link, dedup_key, fanout_at)
      values (${A}, ${TIEN}, 'contracts', 'cc.msg', 'cũ', '', '/contracts/partners', 'cc.msg:x:0', now())`;
    const [msgs] = await o`select count(*)::int as n from hub.pmsg_messages`;
    const sql = readFileSync(
      new URL(
        "../../../../../../../packages/db/migrations-hub/0149_cr169_pmsg.sql",
        import.meta.url,
      ),
      "utf8",
    );
    for (const st of sql.split("--> statement-breakpoint")) if (st.trim()) await o.unsafe(st);
    const [after] = await o`select count(*)::int as n from hub.pmsg_messages`;
    expect(after?.n).toBe(msgs?.n);
    const [bell] = await o`select count(*)::int as n from hub.notifications where kind = 'cc.msg'`;
    expect(bell?.n).toBe(0);
    const [pr] =
      await o`select has_function_privilege('hub_rw', 'hub.pmsg_send(uuid, uuid, text, uuid[])', 'execute') as rw,
      has_function_privilege('public', 'hub.pmsg_send(uuid, uuid, text, uuid[])', 'execute') as pub,
      has_function_privilege('hub_rw', 'hub.cc_links(text, timestamptz, uuid, integer)', 'execute') as links`;
    expect([pr?.rw, pr?.pub, pr?.links]).toEqual([true, false, true]);
    expect((await as(B, HA, (tx) => inbox(tx))).length).toBe(1); // vẫn chạy sau khi áp lại
  });
});
