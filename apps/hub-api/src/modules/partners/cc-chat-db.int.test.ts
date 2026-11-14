// CR-161 · lát 3 · spec §2 R8–R9, R11 · §4 (0146/0147) · §5: trò chuyện giữa hai công ty đã kết nối + tệp, ở tầng DB.
// Role thật `hub_api` (scope user). Luồng suy từ (app.tenant_id, p_other); chỉ người Toàn quyền (việc `admin` gói contracts) dùng được (R1).
// N2: Dung (Toàn quyền của B, không phải người tạo dữ liệu nào) nhận, đọc, trả lời được. C = công ty thứ ba ĐÃ kết nối với A nhưng không với B; E = không quan hệ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { enablePack, members, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, inHub, openOwner, type Sql } from "@ai/test-kit/db";

const A = tenantId(1620); // NitiGroup
const B = tenantId(1621); // Preschool Việt
const C = tenantId(1622); // thứ ba, kết nối với A
const E = tenantId(1623); // không quan hệ
const TIEN = userId(1620); // A · Toàn quyền
const VY = userId(1621); // A · nhân viên (không có admin)
const DUNG = userId(1622); // B · Toàn quyền
const BNV = userId(1623); // B · nhân viên
const CUONG = userId(1624); // C · Toàn quyền
const EVA = userId(1625); // E · Toàn quyền
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
type CcFile = { id: string; name: string; mime: string; size: number };
type Msg = {
  seq: number;
  sender_tenant: string;
  sender_name: string;
  sender_company: string;
  body: string;
  files: CcFile[];
  created_at: string;
  mine: boolean;
};
type Sent = {
  thread_id: string;
  seq: string;
  created: boolean;
  message: Msg;
  notify: { tenant_id: string; user_id: string }[];
};

const invite = (tx: Sql, to: string, user: string) =>
  tx`select hub.cc_invite(${to}::uuid, null, ${user}::uuid, 'Mời') as s`.then(
    (r) => r[0]?.s as string,
  );
const accept = (tx: Sql, from: string) =>
  tx`select hub.partner_link_accept(${from}::uuid) as ok`.then((r) => r[0]?.ok as boolean);
const disconnect = (tx: Sql, other: string) =>
  tx`select hub.cc_disconnect(${other}::uuid) as ok`.then((r) => r[0]?.ok as boolean);
const send = (
  tx: Sql,
  other: string,
  user: string,
  name: string,
  cid: string,
  body: string,
  files: string[] = [],
) =>
  tx<Sent[]>`
    select * from hub.cc_send(${other}::uuid, ${cid}::uuid, ${user}::uuid, ${name}, ${body},
      array(select x::uuid from jsonb_array_elements_text(${JSON.stringify(files)}::text::jsonb) x))`.then(
    (r) => r[0] as Sent,
  );
const page = (tx: Sql, other: string, user: string, before: number | null = null, limit = 50) =>
  tx<{ read_only: boolean; last_read_seq: string; items: Msg[] }[]>`
    select * from hub.cc_thread_page(${other}::uuid, ${user}::uuid, ${before}::bigint, ${limit}::int)`.then(
    (r) => r[0] as { read_only: boolean; last_read_seq: string; items: Msg[] },
  );
const markRead = (tx: Sql, other: string, user: string, seq: number) =>
  tx`select hub.cc_mark_read(${other}::uuid, ${user}::uuid, ${seq}::bigint) as n`.then((r) =>
    Number(r[0]?.n),
  );
const fileAdd = (
  tx: Sql,
  other: string,
  user: string,
  id: string,
  key: string,
  over: { name?: string; size?: number } = {},
) =>
  tx`select hub.cc_file_add(${other}::uuid, ${user}::uuid, ${id}::uuid, ${over.name ?? "hop-dong.pdf"},
    'application/pdf', ${over.size ?? 1000}::bigint, ${key}) as f`.then((r) => r[0]?.f as CcFile);
const fileGet = (tx: Sql, id: string, user: string) =>
  tx`select hub.cc_file_get(${id}::uuid, ${user}::uuid) as k`.then((r) => r[0]?.k as string | null);
const unread = (tx: Sql, others: string[], user: string) =>
  tx<{ other_tenant: string; unread: number }[]>`
    select * from hub.cc_unread(array(select x::uuid from jsonb_array_elements_text(${JSON.stringify(others)}::text::jsonb) x), ${user}::uuid)`.then(
    (r) => r.map((x) => ({ ...x })),
  );
const links = (tx: Sql) =>
  tx<{ tenant_id: string; status: string; unread: number }[]>`
    select tenant_id, status, unread from hub.cc_links(null, null::timestamptz, null::uuid, 20)`.then(
    (r) => r.map((x) => ({ ...x })),
  );

const bells = (tenant: string, kind = "cc.msg") =>
  o<{ user_id: string; title: string; link: string; fanout_at: Date | null }[]>`
    select user_id, title, link, fanout_at from hub.notifications
     where tenant_id = ${tenant} and source = 'contracts' and kind = ${kind} order by seq`;
const lo = (x: string, y: string) => (x < y ? x : y);
const hi = (x: string, y: string) => (x < y ? y : x);
const thread = (x: string, y: string) =>
  o<{ id: string; last_seq: string }[]>`
    select id, last_seq from hub.cc_threads where tenant_lo = ${lo(x, y)} and tenant_hi = ${hi(x, y)}`;
const lastSeq = async (x: string, y: string) => Number((await thread(x, y))[0]?.last_seq ?? -1);
const upload = async (other: string, tenant: string, user: string, over = {}) => {
  const id = randomUUID();
  await as(tenant, user, (tx) => fileAdd(tx, other, user, id, `${tenant}/${id}`, over));
  return id;
};

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  await o`insert into admin.tenants (id, key, name, legal_name, tax_code, directory_listed)
    values (${A}, 'cx-a', 'A', 'NitiGroup', '0100000201', true),
           (${B}, 'cx-b', 'B', 'Preschool Việt', '0100000202', true),
           (${C}, 'cx-c', 'C', 'Công ty Cờ', '0100000203', true),
           (${E}, 'cx-e', 'E', 'Công ty Ê', '0100000204', true)`;
  await users(o, A, 2, { from: 1620 }); // Tiên, Vy
  await users(o, B, 2, { from: 1622 }); // Dung, Bnv
  await users(o, C, 1, { from: 1624 }); // Cường
  await users(o, E, 1, { from: 1625 }); // Eva
  const g = await enablePack(o, [A, B, C, E], "contracts");
  await members(o, A, g.get(A)?.owner as string, [TIEN]);
  await members(o, A, g.get(A)?.editor as string, [VY]);
  await members(o, B, g.get(B)?.owner as string, [DUNG]);
  await members(o, B, g.get(B)?.viewer as string, [BNV]);
  await members(o, C, g.get(C)?.owner as string, [CUONG]);
  await members(o, E, g.get(E)?.owner as string, [EVA]);
  // A–B và A–C đã kết nối (mời → đồng ý bằng đúng hàm của lát 2).
  expect(await as(A, TIEN, (tx) => invite(tx, B, TIEN))).toBe("pending_out");
  expect(await as(B, DUNG, (tx) => accept(tx, A))).toBe(true);
  expect(await as(A, TIEN, (tx) => invite(tx, C, TIEN))).toBe("pending_out");
  expect(await as(C, CUONG, (tx) => accept(tx, A))).toBe(true);
}, 90_000);
afterAll(async () => {
  await o?.end({ timeout: 2 });
});

describe("CR-161 · R8 luồng chưa có", () => {
  it("đang kết nối mà chưa nhắn ⇒ trống, không tạo luồng; chưa từng kết nối ⇒ CC404", async () => {
    const p = await as(A, TIEN, (tx) => page(tx, B, TIEN));
    expect(p).toMatchObject({ read_only: false, items: [] });
    expect(Number(p.last_read_seq)).toBe(0);
    expect(await thread(A, B)).toHaveLength(0);
    expect(await fail(() => as(E, EVA, (tx) => page(tx, A, EVA)))).toMatchObject({
      code: "CC404",
      message: "CONNECT_NO_THREAD",
    });
    expect((await fail(() => as(C, CUONG, (tx) => page(tx, B, CUONG)))).code).toBe("CC404");
    expect(await o`select 1 from hub.cc_threads`).toHaveLength(0);
  });
});

describe("CR-161 · R8 gửi tin, R9 chuông", () => {
  const c1 = randomUUID();
  it("Tiên gửi ⇒ seq 1; Dung nhận ĐÚNG một chuông (không email, không nhân viên, không người gửi); gửi lặp cùng client_id ⇒ tin cũ", async () => {
    const r = await as(A, TIEN, (tx) => send(tx, B, TIEN, "Tiên", c1, "Chào Preschool"));
    expect(Number(r.seq)).toBe(1);
    expect(r.created).toBe(true);
    expect(r.message).toMatchObject({
      seq: 1,
      sender_tenant: A,
      sender_name: "Tiên",
      sender_company: "NitiGroup",
      body: "Chào Preschool",
      files: [],
      mine: true,
    });
    // Người nhận stream: người Toàn quyền của CẢ HAI công ty (gồm tab khác của người gửi), không có nhân viên.
    expect(r.notify.map((n) => `${n.tenant_id}:${n.user_id}`).sort()).toEqual(
      [`${A}:${TIEN}`, `${B}:${DUNG}`].sort(),
    );
    const bs = await bells(B);
    expect(bs).toHaveLength(1);
    expect(bs[0]).toMatchObject({
      user_id: DUNG,
      title: "Tin nhắn mới từ NitiGroup",
      link: `/contracts/partners?party=NitiGroup&tenant=${A}&tab=chat`,
    });
    expect(bs[0]?.fanout_at).not.toBeNull();
    expect(await bells(A)).toHaveLength(0);
    expect(await o`select 1 from hub.notification_deliveries`).toHaveLength(0);
    // Lặp.
    const again = await as(A, TIEN, (tx) => send(tx, B, TIEN, "Tiên", c1, "nội dung khác"));
    expect(again.created).toBe(false);
    expect(Number(again.seq)).toBe(1);
    expect(again.message.body).toBe("Chào Preschool");
    expect(again.notify).toEqual([]);
    expect(await lastSeq(A, B)).toBe(1);
    expect(await o`select 1 from hub.cc_messages`).toHaveLength(1);
    expect(await bells(B)).toHaveLength(1);
  });

  it("tin thứ hai khi Dung chưa đọc ⇒ vẫn một chuông chưa đọc; Dung thấy 2 chưa đọc; đọc (chỉ tiến, kẹp last_seq) ⇒ tin sau lại có chuông mới", async () => {
    const r2 = await as(A, TIEN, (tx) => send(tx, B, TIEN, "Tiên", randomUUID(), "Tin hai"));
    expect(Number(r2.seq)).toBe(2);
    expect(await bells(B)).toHaveLength(1); // khử trùng R9
    const p = await as(B, DUNG, (tx) => page(tx, A, DUNG));
    expect(p.items.map((m) => m.seq)).toEqual([2, 1]);
    expect(p.items.every((m) => m.mine === false)).toBe(true);
    expect(Number(p.last_read_seq)).toBe(0);
    expect(p.read_only).toBe(false);
    expect(await as(B, DUNG, (tx) => unread(tx, [A, C, E], DUNG))).toEqual([
      { other_tenant: A, unread: 2 },
    ]);
    expect(await as(B, DUNG, (tx) => links(tx))).toEqual([
      { tenant_id: A, status: "connected", unread: 2 },
    ]);
    // Người gửi đã đọc tới tin của mình.
    expect(await as(A, TIEN, (tx) => unread(tx, [B], TIEN))).toEqual([
      { other_tenant: B, unread: 0 },
    ]);
    expect(Number((await as(A, TIEN, (tx) => page(tx, B, TIEN))).last_read_seq)).toBe(2);
    // Đọc.
    expect(await as(B, DUNG, (tx) => markRead(tx, A, DUNG, 1))).toBe(1);
    expect(await as(B, DUNG, (tx) => markRead(tx, A, DUNG, 0))).toBe(1); // không lùi
    expect(await as(B, DUNG, (tx) => markRead(tx, A, DUNG, 99))).toBe(2); // kẹp last_seq
    expect((await as(B, DUNG, (tx) => unread(tx, [A], DUNG)))[0]?.unread).toBe(0);
    await as(A, TIEN, (tx) => send(tx, B, TIEN, "Tiên", randomUUID(), "Tin ba"));
    expect(await bells(B)).toHaveLength(2); // dedup 'cc.msg:<thread>:2' khác ':0'
    expect((await as(B, DUNG, (tx) => links(tx)))[0]?.unread).toBe(1);
  });

  it("Dung trả lời (cùng client_id nhưng khác người gửi ⇒ tin mới, N2) ⇒ chuông chỉ cho Tiên; phân trang theo seq", async () => {
    const r = await as(B, DUNG, (tx) => send(tx, A, DUNG, "Dung", c1, "Chào NitiGroup"));
    expect(r.created).toBe(true);
    expect(Number(r.seq)).toBe(4);
    expect(r.message).toMatchObject({ sender_company: "Preschool Việt", mine: true });
    const bs = await bells(A);
    expect(bs).toHaveLength(1);
    expect(bs[0]).toMatchObject({ user_id: TIEN, title: "Tin nhắn mới từ Preschool Việt" });
    expect((await as(A, TIEN, (tx) => links(tx)))[0]).toMatchObject({ tenant_id: B, unread: 1 });
    const p1 = await as(B, DUNG, (tx) => page(tx, A, DUNG, null, 2));
    expect(p1.items.map((m) => [m.seq, m.mine])).toEqual([
      [4, true],
      [3, false],
    ]);
    const p2 = await as(B, DUNG, (tx) => page(tx, A, DUNG, 3, 2));
    expect(p2.items.map((m) => m.seq)).toEqual([2, 1]);
    expect((await as(B, DUNG, (tx) => page(tx, A, DUNG, 1, 2))).items).toEqual([]);
  });
});

describe("CR-161 · R1/R8 kiểm đầu vào và quyền", () => {
  it("rỗng / quá dài / quá nhiều tệp / tự gửi ⇒ lỗi, không đổi seq", async () => {
    const before = await lastSeq(A, B);
    const go = (body: string, files: string[] = [], other = B) =>
      fail(() => as(A, TIEN, (tx) => send(tx, other, TIEN, "Tiên", randomUUID(), body, files)));
    expect(await go("")).toMatchObject({ code: "CC422", message: "MSG_EMPTY" });
    expect(await go("   \n ")).toMatchObject({ code: "CC422", message: "MSG_EMPTY" });
    expect(await go("x".repeat(4001))).toMatchObject({ code: "22023", message: "MSG_TOO_LONG" });
    expect(
      await go(
        "x",
        Array.from({ length: 11 }, () => randomUUID()),
      ),
    ).toMatchObject({ code: "22023", message: "MSG_TOO_MANY_FILES" });
    expect((await go("x", [], A)).code).toBe("22023");
    expect(await lastSeq(A, B)).toBe(before);
  });

  it("nhân viên (Vy, Bnv), người Toàn quyền của công ty khác đứng tên, không đặt tenant ⇒ 42501 ở mọi hàm", async () => {
    const f = randomUUID();
    const calls: Array<[string, string, (tx: Sql, u: string) => Promise<unknown>]> = [
      [A, VY, (tx, u) => send(tx, B, u, "Vy", randomUUID(), "x")],
      [B, BNV, (tx, u) => send(tx, A, u, "Bnv", randomUUID(), "x")],
      [A, VY, (tx, u) => page(tx, B, u)],
      [A, VY, (tx, u) => markRead(tx, B, u, 1)],
      [A, VY, (tx, u) => fileAdd(tx, B, u, f, `${A}/${f}`)],
      [A, VY, (tx, u) => fileGet(tx, f, u)],
      [A, VY, (tx, u) => unread(tx, [B], u)],
    ];
    for (const [t, u, fn] of calls)
      expect((await fail(() => as(t, u, (tx) => fn(tx, u)))).code).toBe("42501");
    // p_user khác app.user_id; Dung không phải người của A.
    expect(
      (await fail(() => as(A, TIEN, (tx) => send(tx, B, DUNG, "Dung", randomUUID(), "x")))).code,
    ).toBe("42501");
    expect(
      (await fail(() => as(A, DUNG, (tx) => send(tx, B, DUNG, "Dung", randomUUID(), "x")))).code,
    ).toBe("42501");
    const none: Array<(tx: Sql) => Promise<unknown>> = [
      (tx) => send(tx, B, TIEN, "Tiên", randomUUID(), "x"),
      (tx) => page(tx, B, TIEN),
      (tx) => markRead(tx, B, TIEN, 1),
      (tx) => fileAdd(tx, B, TIEN, f, `${A}/${f}`),
      (tx) => fileGet(tx, f, TIEN),
      (tx) => unread(tx, [B], TIEN),
    ];
    for (const fn of none) expect((await fail(() => inHub("none", fn))).code).toBe("42501");
    expect(await lastSeq(A, B)).toBe(4);
  });
});

describe("CR-161 · R11 tệp", () => {
  let f1 = "";
  let f2 = "";
  it("tải lên ghi vào luồng; tên/kích cỡ/khoá sai ⇒ 23514; gắn tin chỉ tệp của chính mình, cùng luồng, chưa gắn, không trùng", async () => {
    f1 = randomUUID();
    const added = await as(A, TIEN, (tx) => fileAdd(tx, B, TIEN, f1, `${A}/${f1}`));
    expect(added).toEqual({ id: f1, name: "hop-dong.pdf", mime: "application/pdf", size: 1000 });
    const bad = randomUUID();
    const code = (fn: (tx: Sql) => Promise<unknown>) =>
      fail(() => as(A, TIEN, fn)).then((x) => x.code);
    expect(await code((tx) => fileAdd(tx, B, TIEN, bad, `${B}/${bad}`))).toBe("23514"); // khoá không đúng công ty bên tải
    expect(await code((tx) => fileAdd(tx, B, TIEN, bad, `${A}/${bad}`, { size: 20_971_521 }))).toBe(
      "23514",
    );
    expect(await code((tx) => fileAdd(tx, B, TIEN, bad, `${A}/${bad}`, { name: "" }))).toBe(
      "23514",
    );
    expect(await code((tx) => fileAdd(tx, B, TIEN, f1, `${A}/${f1}`))).toBe("23505"); // trùng id
    // Gắn tin.
    const cid = randomUUID();
    const s = await as(A, TIEN, (tx) => send(tx, B, TIEN, "Tiên", cid, "", [f1]));
    expect(Number(s.seq)).toBe(5);
    expect(s.message.files).toEqual([added]);
    expect(Number((await o`select seq from hub.cc_files where id = ${f1}`)[0]?.seq)).toBe(5);
    // Gửi lặp đúng gói cũ (kể cả thân rỗng + tệp) ⇒ tin cũ.
    const again = await as(A, TIEN, (tx) => send(tx, B, TIEN, "Tiên", cid, "", [f1]));
    expect([again.created, Number(again.seq)]).toEqual([false, 5]);
    // Tệp không hợp lệ ⇒ CC422, không đổi seq.
    f2 = await upload(B, A, TIEN);
    const fD = await upload(A, B, DUNG);
    const fAC = await upload(C, A, TIEN); // luồng A–C
    const invalid = async (u: string, t: string, other: string, files: string[]) =>
      expect(
        await fail(() => as(t, u, (tx) => send(tx, other, u, "x", randomUUID(), "có tệp", files))),
      ).toMatchObject({ code: "CC422", message: "MSG_FILE_INVALID" });
    await invalid(DUNG, B, A, [f2]); // tệp của người khác
    await invalid(TIEN, A, B, [f1]); // đã gắn tin
    await invalid(TIEN, A, B, [f2, f2]); // trùng
    await invalid(TIEN, A, B, [randomUUID()]); // không tồn tại
    await invalid(TIEN, A, B, [fD]); // của Dung
    await invalid(TIEN, A, B, [fAC]); // của luồng A–C
    expect(await lastSeq(A, B)).toBe(5);
    // Nhiều tệp giữ đúng thứ tự gửi.
    const f3 = await upload(B, A, TIEN, { name: "bang-gia.xlsx" });
    const m = await as(A, TIEN, (tx) =>
      send(tx, B, TIEN, "Tiên", randomUUID(), "hai tệp", [f3, f2]),
    );
    expect(Number(m.seq)).toBe(6);
    expect(m.message.files.map((x) => x.id)).toEqual([f3, f2]);
  });

  it("tải xuống: người Toàn quyền hai công ty trong cặp; tệp chưa gắn chỉ người tải; công ty thứ ba / nhân viên không", async () => {
    const key = `${A}/${f1}`;
    expect(await as(A, TIEN, (tx) => fileGet(tx, f1, TIEN))).toBe(key);
    expect(await as(B, DUNG, (tx) => fileGet(tx, f1, DUNG))).toBe(key);
    expect(await as(C, CUONG, (tx) => fileGet(tx, f1, CUONG))).toBeNull(); // C kết nối với A nhưng không thuộc cặp A–B
    expect(await as(E, EVA, (tx) => fileGet(tx, f1, EVA))).toBeNull();
    expect((await fail(() => as(A, VY, (tx) => fileGet(tx, f1, VY)))).code).toBe("42501");
    const pending = await upload(B, A, TIEN); // chưa gắn tin
    expect(await as(A, TIEN, (tx) => fileGet(tx, pending, TIEN))).toBe(`${A}/${pending}`);
    expect(await as(B, DUNG, (tx) => fileGet(tx, pending, DUNG))).toBeNull();
    expect(await as(A, TIEN, (tx) => fileGet(tx, randomUUID(), TIEN))).toBeNull();
  });
});

describe("CR-161 · công ty thứ ba không đọc/ghi luồng A–B", () => {
  it("C (đã kết nối A) chỉ thấy luồng A–C; gửi/đọc/đánh dấu/tải tệp luồng A–B đều bị chặn; E không quan hệ ⇒ 409/404", async () => {
    const seq = await lastSeq(A, B);
    const reads = (await o`select 1 from hub.cc_reads`).length;
    expect(
      await fail(() =>
        as(C, CUONG, (tx) => send(tx, B, CUONG, "Cường", randomUUID(), "chen ngang")),
      ),
    ).toMatchObject({
      code: "CC409",
      message: "CONNECT_READ_ONLY",
    });
    expect(
      (await fail(() => as(E, EVA, (tx) => send(tx, A, EVA, "Eva", randomUUID(), "x")))).code,
    ).toBe("CC409");
    expect((await fail(() => as(E, EVA, (tx) => page(tx, B, EVA)))).code).toBe("CC404");
    const fC = randomUUID();
    expect(
      (await fail(() => as(C, CUONG, (tx) => fileAdd(tx, B, CUONG, fC, `${C}/${fC}`)))).code,
    ).toBe("CC409");
    expect(await as(C, CUONG, (tx) => markRead(tx, B, CUONG, 99))).toBe(0);
    expect(await as(E, EVA, (tx) => unread(tx, [A, B], EVA))).toEqual([]);
    expect(
      (await as(C, CUONG, (tx) => unread(tx, [A, B], CUONG))).map((r) => r.other_tenant),
    ).toEqual([A]);
    expect(await lastSeq(A, B)).toBe(seq);
    expect((await o`select 1 from hub.cc_reads`).length).toBe(reads);
    // C đọc luồng của mình với A: chỉ tin A–C (không lẫn A–B).
    const p = await as(C, CUONG, (tx) => page(tx, A, CUONG));
    expect(p).toMatchObject({ read_only: false, items: [] });
    const ac = await as(C, CUONG, (tx) => send(tx, A, CUONG, "Cường", randomUUID(), "Chào A"));
    expect(Number(ac.seq)).toBe(1);
    expect(await lastSeq(A, B)).toBe(seq);
    expect(
      (await as(A, TIEN, (tx) => page(tx, B, TIEN))).items.some((m) => m.body === "Chào A"),
    ).toBe(false);
    expect((await as(A, TIEN, (tx) => page(tx, C, TIEN))).items.map((m) => m.body)).toEqual([
      "Chào A",
    ]);
  });

  it("bảng không đọc/ghi thẳng được từ scope người dùng (RLS chỉ cho scope system)", async () => {
    for (const t of ["cc_threads", "cc_messages", "cc_reads", "cc_files"]) {
      expect(await as(C, CUONG, (tx) => tx.unsafe(`select * from hub.${t}`))).toHaveLength(0);
    }
    const w = (q: string) => fail(() => as(A, TIEN, (tx) => tx.unsafe(q))).then((x) => x.code);
    expect(
      await w(
        "insert into hub.cc_reads (thread_id, user_id, tenant_id) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid())",
      ),
    ).toBe("42501");
    expect(await w("update hub.cc_threads set last_seq = 0")).toBe("42501");
    expect(await w("delete from hub.cc_messages")).toBe("42501");
    expect(await w("update hub.cc_messages set body = 'x'")).toBe("42501");
    // Chỉ cột deleted_at của cc_files có quyền UPDATE (việc nền); ở scope người dùng RLS ⇒ 0 dòng.
    await as(A, TIEN, (tx) => tx`update hub.cc_files set deleted_at = now()`);
    expect(await o`select 1 from hub.cc_files where deleted_at is not null`).toHaveLength(0);
  });
});

describe("CR-161 · R6/R8 sau ngắt chỉ đọc, kết nối lại dùng chính luồng cũ", () => {
  it("ngắt ⇒ cả hai đọc được tin cũ + tải tệp cũ; gửi/tải lên ⇒ CC409; đánh dấu đọc vẫn được; C vẫn không thấy", async () => {
    const n = await lastSeq(A, B);
    expect(await as(A, TIEN, (tx) => disconnect(tx, B))).toBe(true);
    for (const [t, u, other] of [
      [A, TIEN, B],
      [B, DUNG, A],
    ] as const) {
      const p = await as(t, u, (tx) => page(tx, other, u));
      expect(p.read_only).toBe(true);
      expect(p.items).toHaveLength(n);
      expect(
        await fail(() => as(t, u, (tx) => send(tx, other, u, "x", randomUUID(), "sau ngắt"))),
      ).toMatchObject({ code: "CC409", message: "CONNECT_READ_ONLY" });
      const fid = randomUUID();
      expect(
        (await fail(() => as(t, u, (tx) => fileAdd(tx, other, u, fid, `${t}/${fid}`)))).code,
      ).toBe("CC409");
    }
    expect(await lastSeq(A, B)).toBe(n);
    expect(await as(B, DUNG, (tx) => fileGet(tx, randomUUID(), DUNG))).toBeNull();
    expect(await as(B, DUNG, (tx) => markRead(tx, A, DUNG, n))).toBe(n);
    expect((await fail(() => as(C, CUONG, (tx) => page(tx, B, CUONG)))).code).toBe("CC404");
    expect((await as(A, TIEN, (tx) => links(tx))).map((r) => r.tenant_id)).toEqual([C]);
    const fid = (await o`select id from hub.cc_files where seq is not null limit 1`)[0]
      ?.id as string;
    expect(await as(B, DUNG, (tx) => fileGet(tx, fid, DUNG))).not.toBeNull();
  });

  it("mời lại + đồng ý ⇒ cùng luồng (không tạo luồng thứ hai), seq nối tiếp, gửi được", async () => {
    const n = await lastSeq(A, B);
    const id = (await thread(A, B))[0]?.id;
    expect(await as(A, TIEN, (tx) => invite(tx, B, TIEN))).toBe("pending_out");
    expect(await as(B, DUNG, (tx) => accept(tx, A))).toBe(true);
    expect((await as(A, TIEN, (tx) => page(tx, B, TIEN))).read_only).toBe(false);
    const r = await as(B, DUNG, (tx) => send(tx, A, DUNG, "Dung", randomUUID(), "Kết nối lại"));
    expect(Number(r.seq)).toBe(n + 1);
    expect(r.thread_id).toBe(id);
    expect(await thread(A, B)).toHaveLength(1);
  });
});

describe("CR-161 · đồng thời", () => {
  it("8 tin song song ⇒ seq liên tục không trùng; 5 lần gửi cùng client_id song song ⇒ đúng một tin", async () => {
    const n = await lastSeq(A, B);
    const rs = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        as(A, TIEN, (tx) => send(tx, B, TIEN, "Tiên", randomUUID(), `song song ${i}`)),
      ),
    );
    expect(rs.map((r) => Number(r.seq)).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 8 }, (_, i) => n + 1 + i),
    );
    const same = randomUUID();
    const ds = await Promise.all(
      Array.from({ length: 5 }, () =>
        as(B, DUNG, (tx) => send(tx, A, DUNG, "Dung", same, "một tin")),
      ),
    );
    expect(ds.filter((d) => d.created)).toHaveLength(1);
    expect(new Set(ds.map((d) => Number(d.seq))).size).toBe(1);
    expect(await lastSeq(A, B)).toBe(n + 9);
  });
});

describe("CR-161 · hàm nội bộ không gọi được từ hub_rw (Minor #3 soát lát 2)", () => {
  it("cc_bell / cc_do_accept / cc_owners_raw / cc_connected_raw / cc_status_of / cc_urlenc / cc_ctx / cc_thread_ensure / cc_msg_json ⇒ 42501", async () => {
    const calls: Array<(tx: Sql) => Promise<unknown>> = [
      (tx) => tx`select hub.cc_bell(${A}::uuid, null, 'cc.msg', 't', '', null, 'k')`,
      (tx) => tx`select hub.cc_do_accept(${A}::uuid, ${B}::uuid)`,
      (tx) => tx`select * from hub.cc_owners_raw(array[${A}::uuid])`,
      (tx) => tx`select hub.cc_connected_raw(${A}::uuid, ${B}::uuid)`,
      (tx) =>
        tx`select hub.cc_status_of(null::timestamptz, null::timestamptz, null::timestamptz, null::timestamptz, null::timestamptz, null::timestamptz, null::timestamptz)`,
      (tx) => tx`select hub.cc_urlenc('a b')`,
      (tx) => tx`select hub.cc_ctx(${TIEN}::uuid)`,
      (tx) => tx`select * from hub.cc_thread_ensure(${A}::uuid, ${B}::uuid)`,
      (tx) => tx`select hub.cc_msg_json(null::hub.cc_messages, 'x', ${A}::uuid)`,
    ];
    for (const c of calls) {
      expect((await fail(() => as(A, TIEN, c))).code).toBe("42501");
      expect((await fail(() => as(A, VY, c))).code).toBe("42501");
    }
    expect(
      await o`select 1 from hub.cc_threads where tenant_lo = ${lo(A, B)} and tenant_hi = ${hi(A, B)}`,
    ).toHaveLength(1);
  });
});
