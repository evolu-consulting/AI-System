// CR-161 · lát 2 · spec §2 R3–R7, R9 · §5 · hub 0145: mời / đồng ý / từ chối / ngắt / danh sách / chuông, cách ly công ty thứ ba.
// Role thật `hub_api` (scope user). Quyền người dùng (R1) ở route; ở DB `cc_invite` buộc người mời là người Toàn quyền (việc `admin` gói contracts).
// N2: Dung là người Toàn quyền của B, KHÔNG phải người tạo dữ liệu nào, không phải tenant_admin — vẫn đồng ý được.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { enablePack, members, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, inHub, openOwner, type Sql } from "@ai/test-kit/db";

const A = tenantId(1610); // NitiGroup
const B = tenantId(1611); // Preschool
const C = tenantId(1612); // công ty thứ ba
const E = tenantId(1613); // không bật Danh bạ
const F = tenantId(1614); // đường cũ (gửi HĐ lần đầu)
const G = tenantId(1615); // chặn A trước
const H = tenantId(1616); // A từng chặn
const TIEN = userId(1610); // A · Toàn quyền
const VY = userId(1611); // A · nhân viên (editor, không có admin)
const DUNG = userId(1612); // B · Toàn quyền
const BNV = userId(1613); // B · nhân viên
const CUONG = userId(1614); // C · Toàn quyền
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
const invite = (tx: Sql, to: string, note: string | null, user: string, name = "Tiên") =>
  tx`select hub.cc_invite(${to}::uuid, ${note}, ${user}::uuid, ${name}) as s`.then(
    (r) => r[0]?.s as string,
  );
const accept = (tx: Sql, from: string) =>
  tx`select hub.partner_link_accept(${from}::uuid) as ok`.then((r) => r[0]?.ok as boolean);
const block = (tx: Sql, from: string) =>
  tx`select hub.partner_link_block(${from}::uuid) as ok`.then((r) => r[0]?.ok as boolean);
const disconnect = (tx: Sql, other: string) =>
  tx`select hub.cc_disconnect(${other}::uuid) as ok`.then((r) => r[0]?.ok as boolean);
const connected = (tx: Sql, a: string, b: string) =>
  tx`select hub.cc_connected(${a}::uuid, ${b}::uuid) as c`.then((r) => r[0]?.c as boolean);
const search = (tx: Sql, q: string) =>
  tx<{ tenant_id: string; legal_name: string; tax_code: string; status: string }[]>`
    select * from hub.cc_search(${q})`;
const links = (
  tx: Sql,
  status: string | null = null,
  limit = 20,
  t: Date | null = null,
  id: string | null = null,
) =>
  tx<
    {
      tenant_id: string;
      legal_name: string;
      status: string;
      note: string | null;
      invited_by_name: string | null;
      since: Date;
    }[]
  >`
    select * from hub.cc_links(${status}, ${t}::timestamptz, ${id}::uuid, ${limit}::int)`;
const send = (tx: Sql, from: string, to: string) =>
  tx`select hub.partner_send(${from}::uuid, ${to}::uuid, null, 'platform', 'r', '{}'::jsonb, null, null,
    now() + interval '7 days', null)::text as id`.then((r) => r[0]?.id as string);
const row = (from: string, to: string) =>
  o<
    {
      requested_at: Date | null;
      accepted_at: Date | null;
      blocked_at: Date | null;
      connect_requested_at: Date | null;
      connect_note: string | null;
      connect_by: string | null;
    }[]
  >`select requested_at, accepted_at, blocked_at, connect_requested_at, connect_note, connect_by
      from hub.partner_links where from_tenant = ${from} and to_tenant = ${to}`;
const bells = (tenant: string) =>
  o<
    {
      user_id: string;
      kind: string;
      title: string;
      body: string;
      link: string;
      fanout_at: Date | null;
    }[]
  >`
    select user_id, kind, title, body, link, fanout_at from hub.notifications
     where tenant_id = ${tenant} and source = 'contracts' and kind like 'cc.%' order by seq`;
const nRows = () =>
  o`select count(*)::int as n from hub.partner_links`.then((r) => r[0]?.n as number);

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  await o`insert into admin.tenants (id, key, name, legal_name, tax_code, directory_listed, directory_verified_at, directory_verified_by)
    values (${A}, 'cc-a', 'A', 'NitiGroup', '0100000101', true, null, null),
           (${B}, 'cc-b', 'B', 'Preschool Việt', '0100000102', true, null, null),
           (${C}, 'cc-c', 'C', 'Công ty Cờ', '0100000103', true, null, null),
           (${E}, 'cc-e', 'E', 'Công ty Ê', '0100000104', false, null, null),
           (${F}, 'cc-f', 'F', 'Công ty Ép', '0100000105-001', true, null, null),
           (${G}, 'cc-g', 'G', 'Công ty Gờ', '0100000106', true, null, null),
           (${H}, 'cc-h', 'H', 'Công ty Hát', '0100000107', true, null, null)`;
  await users(o, A, 2, { from: 1610 }); // Tiên, Vy
  await users(o, B, 2, { from: 1612 }); // Dung, Bnv
  await users(o, C, 1, { from: 1614 }); // Cường
  const g = await enablePack(o, [A, B, C], "contracts");
  await members(o, A, g.get(A)?.owner as string, [TIEN]);
  await members(o, A, g.get(A)?.editor as string, [VY]);
  await members(o, B, g.get(B)?.owner as string, [DUNG]);
  await members(o, B, g.get(B)?.viewer as string, [BNV]);
  await members(o, C, g.get(C)?.owner as string, [CUONG]);
}, 60_000);
afterAll(async () => {
  await o?.end({ timeout: 2 });
});

describe("CR-161 · R2 tìm công ty (Danh bạ)", () => {
  it("MST đúng hoặc tên ≥ 3 ký tự; không thấy công ty chưa bật, không thấy chính mình; chưa đặt tenant ⇒ 42501", async () => {
    expect((await as(A, TIEN, (tx) => search(tx, "0100000102"))).map((r) => r.tenant_id)).toEqual([
      B,
    ]);
    // MST có chi nhánh: nhập liền 13 số hoặc có dấu «-» đều khớp.
    expect(
      (await as(A, TIEN, (tx) => search(tx, "0100000105001"))).map((r) => r.tenant_id),
    ).toEqual([F]);
    expect(
      (await as(A, TIEN, (tx) => search(tx, "0100000105-001"))).map((r) => r.tenant_id),
    ).toEqual([F]);
    const byName = await as(A, TIEN, (tx) => search(tx, "  preschool "));
    expect(byName).toHaveLength(1);
    expect(byName[0]).toMatchObject({ tenant_id: B, legal_name: "Preschool Việt", status: "none" });
    expect(await as(A, TIEN, (tx) => search(tx, "ab"))).toHaveLength(0); // chưa đủ ký tự
    expect(await as(A, TIEN, (tx) => search(tx, "Công ty Ê"))).toHaveLength(0); // E chưa bật Danh bạ
    expect(await as(A, TIEN, (tx) => search(tx, "NitiGroup"))).toHaveLength(0); // loại chính A
    expect(await as(A, TIEN, (tx) => search(tx, "100%"))).toHaveLength(0); // ký tự đại diện bị thoát
    expect((await fail(() => inHub("none", (tx) => search(tx, "Preschool")))).code).toBe("42501");
  });
});

describe("CR-161 · R3 gửi lời mời + R9 chuông", () => {
  it("không bật Danh bạ ⇒ CC422; tự mời ⇒ 22023; nhân viên (Vy) ⇒ 42501 và không đổi gì; lời nhắn > 500 ⇒ 22023", async () => {
    const before = await nRows();
    expect(await fail(() => as(A, TIEN, (tx) => invite(tx, E, null, TIEN)))).toMatchObject({
      code: "CC422",
      message: "CONNECT_NOT_LISTED",
    });
    expect((await fail(() => as(A, TIEN, (tx) => invite(tx, A, null, TIEN)))).code).toBe("22023");
    expect((await fail(() => as(A, VY, (tx) => invite(tx, B, "chào", VY, "Vy")))).code).toBe(
      "42501",
    );
    // Người Toàn quyền của công ty KHÁC không đứng tên được cho A.
    expect((await fail(() => as(A, DUNG, (tx) => invite(tx, B, null, DUNG)))).code).toBe("42501");
    expect((await fail(() => as(C, TIEN, (tx) => invite(tx, B, null, TIEN)))).code).toBe("42501");
    expect((await fail(() => as(A, TIEN, (tx) => invite(tx, B, "x".repeat(501), TIEN)))).code).toBe(
      "22023",
    );
    expect((await fail(() => inHub("none", (tx) => invite(tx, B, null, TIEN)))).code).toBe("42501");
    expect(await nRows()).toBe(before);
    expect(await bells(B)).toHaveLength(0);
  });

  it("Tiên mời Preschool kèm lời nhắn ⇒ pending_out; Dung nhận ĐÚNG một chuông (không email, không gửi nhân viên); mời lại không tạo thêm", async () => {
    expect(await as(A, TIEN, (tx) => invite(tx, B, "  Mong hợp tác  ", TIEN))).toBe("pending_out");
    expect(await as(A, TIEN, (tx) => invite(tx, B, "lần hai", TIEN))).toBe("pending_out"); // idempotent
    const r = (await row(A, B))[0];
    expect(r?.connect_requested_at).not.toBeNull();
    expect(r?.connect_note).toBe("Mong hợp tác"); // lần hai không ghi đè
    expect(r?.connect_by).toBe(TIEN);
    expect(r?.accepted_at).toBeNull();
    const bs = await bells(B);
    expect(bs).toHaveLength(1);
    expect(bs[0]).toMatchObject({
      user_id: DUNG,
      kind: "cc.invite",
      title: "NitiGroup muốn kết nối với bạn",
      body: "Mong hợp tác",
      link: "/contracts/partners?invites=1",
    });
    expect(bs[0]?.fanout_at).not.toBeNull(); // đã «chia kênh» ⇒ bộ gửi email/push bỏ qua
    expect(await o`select 1 from hub.notification_deliveries`).toHaveLength(0);
    // Trạng thái nhìn từ hai phía.
    expect((await as(A, TIEN, (tx) => search(tx, "Preschool")))[0]?.status).toBe("pending_out");
    expect((await as(B, DUNG, (tx) => search(tx, "NitiGroup")))[0]?.status).toBe("pending_in");
    const inB = await as(B, DUNG, (tx) => links(tx));
    expect(inB).toHaveLength(1);
    expect(inB[0]).toMatchObject({
      tenant_id: A,
      status: "pending_in",
      note: "Mong hợp tác",
      invited_by_name: "Tiên",
    });
    expect((await as(A, TIEN, (tx) => links(tx, "pending_out")))[0]?.tenant_id).toBe(B);
    expect(await as(A, TIEN, (tx) => links(tx, "connected"))).toHaveLength(0);
  });

  it("công ty thứ ba (C) không thấy lời mời A→B: danh sách rỗng, tìm thấy 'none', không đồng ý/ngắt được, không đọc người Toàn quyền của B", async () => {
    expect(await as(C, CUONG, (tx) => links(tx))).toHaveLength(0);
    expect((await as(C, CUONG, (tx) => search(tx, "Preschool")))[0]?.status).toBe("none");
    expect((await fail(() => as(C, CUONG, (tx) => accept(tx, A)))).code).toBe("42501");
    expect((await fail(() => as(C, CUONG, (tx) => disconnect(tx, A)))).code).toBe("CC409");
    expect(await as(C, CUONG, (tx) => connected(tx, A, B))).toBe(false);
    expect(
      await as(
        C,
        CUONG,
        (tx) => tx`select * from hub.cc_owner_users(array[${B}::uuid, ${A}::uuid])`,
      ),
    ).toHaveLength(0);
    // Bảng không đọc/ghi thẳng được từ scope user (kể cả cột mới).
    expect(await as(C, CUONG, (tx) => tx`select connect_note from hub.partner_links`)).toHaveLength(
      0,
    );
    expect(
      (await fail(() => as(A, TIEN, (tx) => tx`update hub.partner_links set connect_note = 'x'`)))
        .code,
    ).toBe("42501");
  });
});

describe("CR-161 · R4 đồng ý, R6 ngắt", () => {
  it("bên mời không tự đồng ý lời mời của mình (42501); Dung (Toàn quyền, không phải người tạo) đồng ý ⇒ kết nối hai chiều, một lần", async () => {
    expect((await fail(() => as(A, TIEN, (tx) => accept(tx, B)))).code).toBe("42501");
    expect(await as(B, DUNG, (tx) => accept(tx, A))).toBe(true);
    for (const [f, t] of [
      [A, B],
      [B, A],
    ] as const) {
      const r = (await row(f, t))[0];
      expect(r?.accepted_at).not.toBeNull();
      expect(r?.blocked_at).toBeNull();
      expect(r?.connect_requested_at).toBeNull();
    }
    expect(await as(B, DUNG, (tx) => accept(tx, A))).toBe(false); // idempotent
    expect(await as(A, TIEN, (tx) => connected(tx, A, B))).toBe(true);
    expect(await as(B, DUNG, (tx) => connected(tx, A, B))).toBe(true);
    expect(await as(C, CUONG, (tx) => connected(tx, A, B))).toBe(false);
    expect((await as(A, TIEN, (tx) => links(tx)))[0]).toMatchObject({
      tenant_id: B,
      status: "connected",
      note: "Mong hợp tác",
    });
    expect((await as(B, DUNG, (tx) => links(tx)))[0]).toMatchObject({
      tenant_id: A,
      status: "connected",
    });
    // Gửi HĐ đi thẳng cả hai chiều (partner_send 0117/0122 thấy dòng đã chấp nhận ⇒ không bị giữ).
    for (const [f, t] of [
      [A, B],
      [B, A],
    ] as const) {
      const id = await as(f, f === A ? TIEN : DUNG, (tx) => send(tx, f, t));
      const m = await o`select status from hub.partner_mailbox where id = ${id}::uuid`;
      expect(m[0]?.status).toBe("sent");
    }
    // Chuông «đã đồng ý» chỉ cho người mời (Tiên), không cho Vy.
    const bs = (await bells(A)).filter((b) => b.kind === "cc.accepted");
    expect(bs).toHaveLength(1);
    expect(bs[0]).toMatchObject({ user_id: TIEN, title: "Preschool Việt đã đồng ý kết nối" });
    expect(bs[0]?.link).toBe(
      `/contracts/partners?party=Preschool%20Vi%E1%BB%87t&tenant=${B}&tab=chat`,
    );
    // Mời lại khi đã kết nối ⇒ connected, không đổi gì, không thêm chuông.
    const nb = (await bells(B)).length;
    expect(await as(A, TIEN, (tx) => invite(tx, B, null, TIEN))).toBe("connected");
    expect((await bells(B)).length).toBe(nb);
  });

  it("mời chéo: A mời C, C mời lại A ⇒ lập tức connected (thành đồng ý); danh sách phân trang theo con trỏ", async () => {
    expect(await as(A, TIEN, (tx) => invite(tx, C, "xin chào", TIEN))).toBe("pending_out");
    expect(await as(C, CUONG, (tx) => invite(tx, A, null, CUONG, "Cường"))).toBe("connected");
    expect(await bells(C)).toHaveLength(1); // chỉ lời mời ban đầu, lời mời thứ hai không sinh chuông «mời»
    for (const [f, t] of [
      [A, C],
      [C, A],
    ] as const) {
      const r = (await row(f, t))[0];
      expect([
        r?.accepted_at !== null,
        r?.blocked_at === null,
        r?.connect_requested_at === null,
      ]).toEqual([true, true, true]);
    }
    expect((await bells(A)).filter((b) => b.kind === "cc.accepted").length).toBe(2); // B (trước) + C
    const p1 = await as(A, TIEN, (tx) => links(tx, "connected", 1));
    expect(p1).toHaveLength(1);
    const first = p1[0];
    const p2 = await as(A, TIEN, (tx) =>
      links(tx, "connected", 1, first?.since ?? null, first?.tenant_id ?? null),
    );
    expect(p2).toHaveLength(1);
    expect(p2[0]?.tenant_id).not.toBe(first?.tenant_id);
    expect(
      await as(A, TIEN, (tx) =>
        links(tx, "connected", 1, p2[0]?.since ?? null, p2[0]?.tenant_id ?? null),
      ),
    ).toHaveLength(0);
    expect(new Set([first?.tenant_id, p2[0]?.tenant_id])).toEqual(new Set([B, C]));
  });

  it("chưa kết nối mà ngắt ⇒ CC409, không đổi dữ liệu; Tiên ngắt B ⇒ xoá hai dòng, chuông cho Dung, cả hai thấy 'none'; ngắt lại ⇒ CC409", async () => {
    const before = await nRows();
    expect(await fail(() => as(A, TIEN, (tx) => disconnect(tx, E)))).toMatchObject({
      code: "CC409",
      message: "CONNECT_NOT_CONNECTED",
    });
    expect(await nRows()).toBe(before);
    expect(await as(A, TIEN, (tx) => disconnect(tx, B))).toBe(true);
    expect(await row(A, B)).toHaveLength(0);
    expect(await row(B, A)).toHaveLength(0);
    expect(await nRows()).toBe(before - 2);
    expect(await as(B, DUNG, (tx) => connected(tx, A, B))).toBe(false);
    expect((await as(B, DUNG, (tx) => search(tx, "NitiGroup")))[0]?.status).toBe("none");
    const d = (await bells(B)).filter((b) => b.kind === "cc.disconnected");
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ user_id: DUNG, link: "/contracts/partners" });
    expect((await fail(() => as(A, TIEN, (tx) => disconnect(tx, B)))).code).toBe("CC409");
    // C vẫn kết nối với A (không bị ảnh hưởng).
    expect(await as(A, TIEN, (tx) => connected(tx, A, C))).toBe(true);
    // Đường cũ sau ngắt: gửi HĐ lại bị giữ (chưa nối) thay vì đi thẳng.
    const id = await as(A, TIEN, (tx) => send(tx, A, B));
    expect(
      (await o`select status from hub.partner_mailbox where id = ${id}::uuid`)[0]?.status,
    ).toBe("held");
  });
});

describe("CR-161 · R5 từ chối", () => {
  it("Dung từ chối ⇒ A thấy 'declined', mời lại ⇒ CC409 CONNECT_DECLINED không đổi gì, không chuông cho A, danh sách rỗng", async () => {
    expect(await as(A, TIEN, (tx) => invite(tx, B, "thử lại", TIEN))).toBe("pending_out");
    const aBells = (await bells(A)).length;
    expect(await as(B, DUNG, (tx) => block(tx, A))).toBe(true);
    expect((await row(A, B))[0]?.connect_requested_at).toBeNull();
    expect((await row(A, B))[0]?.blocked_at).not.toBeNull();
    expect((await bells(A)).length).toBe(aBells); // Q3: không chuông cho bên mời
    expect((await as(A, TIEN, (tx) => search(tx, "Preschool")))[0]?.status).toBe("declined");
    const snap = JSON.stringify(await row(A, B));
    expect(await fail(() => as(A, TIEN, (tx) => invite(tx, B, "nữa", TIEN)))).toMatchObject({
      code: "CC409",
      message: "CONNECT_DECLINED",
    });
    expect(JSON.stringify(await row(A, B))).toBe(snap);
    expect((await as(A, TIEN, (tx) => links(tx))).map((r) => r.tenant_id)).toEqual([C]);
    expect(await as(B, DUNG, (tx) => links(tx))).toHaveLength(0);
  });
});

describe("CR-161 · đường cũ (gửi HĐ lần đầu kèm lời mời) và chặn trước", () => {
  it("đường cũ: đồng ý chỉ mở MỘT chiều như trước, không thành kết nối", async () => {
    expect(
      await as(A, TIEN, (tx) =>
        tx`select hub.partner_link_request(${F}::uuid) as s`.then((r) => r[0]?.s),
      ),
    ).toBe("pending");
    expect((await row(A, F))[0]?.connect_requested_at).toBeNull();
    expect(await as(F, userId(1699), (tx) => accept(tx, A))).toBe(true);
    expect(await row(F, A)).toHaveLength(0); // không có chiều ngược
    expect(await as(A, TIEN, (tx) => connected(tx, A, F))).toBe(false);
    expect((await as(A, TIEN, (tx) => search(tx, "Công ty Ép")))[0]?.status).toBe("none");
    expect(await as(A, TIEN, (tx) => links(tx))).toHaveLength(1); // chỉ C
    const ok = await as(A, TIEN, (tx) => send(tx, A, F));
    expect(
      (await o`select status from hub.partner_mailbox where id = ${ok}::uuid`)[0]?.status,
    ).toBe("sent");
    // Sau đó A có thể mời kết nối đầy đủ: F đồng ý ⇒ hai chiều.
    expect(await as(A, TIEN, (tx) => invite(tx, F, null, TIEN))).toBe("pending_out");
    expect(await as(F, userId(1699), (tx) => accept(tx, A))).toBe(true);
    expect(await as(A, TIEN, (tx) => connected(tx, A, F))).toBe(true);
  });

  it("B chặn A TRƯỚC khi A từng mời: A không thấy 'declined', mời trả pending_out im lặng, không đổi gì, không chuông", async () => {
    expect(await as(G, userId(1698), (tx) => block(tx, A))).toBe(true);
    expect((await as(A, TIEN, (tx) => search(tx, "Công ty Gờ")))[0]?.status).toBe("none");
    const snap = JSON.stringify(await row(A, G));
    expect(await as(A, TIEN, (tx) => invite(tx, G, "hi", TIEN))).toBe("pending_out");
    expect(JSON.stringify(await row(A, G))).toBe(snap);
    expect((await row(A, G))[0]?.connect_requested_at).toBeNull();
    expect(await bells(G)).toHaveLength(0);
    expect(await as(A, TIEN, (tx) => links(tx, "pending_out"))).toHaveLength(0);
  });

  it("A từng chặn H rồi chủ động mời H ⇒ gỡ chặn của A", async () => {
    expect(await as(A, TIEN, (tx) => block(tx, H))).toBe(true);
    expect((await row(H, A))[0]?.blocked_at).not.toBeNull();
    expect(await as(A, TIEN, (tx) => invite(tx, H, null, TIEN))).toBe("pending_out");
    expect((await row(H, A))[0]?.blocked_at).toBeNull();
    expect((await row(A, H))[0]?.connect_requested_at).not.toBeNull();
  });
});

describe("CR-161 · hàm chuông + người Toàn quyền, cách ly", () => {
  it("cc_owner_users chỉ trả người Toàn quyền, và chỉ của công ty mình / đang kết nối hoặc có lời mời chờ", async () => {
    const own = await as(
      A,
      TIEN,
      (tx) => tx<{ tenant_id: string; user_id: string }[]>`
      select * from hub.cc_owner_users(array[${A}::uuid, ${C}::uuid, ${B}::uuid, ${E}::uuid])`,
    );
    const got = own.map((r) => `${r.tenant_id}:${r.user_id}`).sort();
    expect(got).toEqual([`${A}:${TIEN}`, `${C}:${CUONG}`].sort()); // Vy (editor) không; B đã ngắt; E không quan hệ
    const pending = await as(
      A,
      TIEN,
      (tx) => tx`select * from hub.cc_owner_users(array[${H}::uuid])`,
    );
    expect(pending).toHaveLength(0); // H không có người Toàn quyền (chưa bật gói) — nhưng lời mời chờ hợp lệ không lỗi
  });

  it("cc_notify: chỉ nhận người Toàn quyền công ty đang kết nối; nhân viên, kind ngoài cc.*, công ty lạ ⇒ bỏ qua; trùng khoá ⇒ một chuông", async () => {
    const batch = (rows: object[]) => JSON.stringify(rows);
    const item = (tenant: string, user: string, kind = "cc.msg", dedup = "d1") => ({
      tenant_id: tenant,
      user_id: user,
      kind,
      title: "Tin nhắn mới từ NitiGroup",
      dedup_key: dedup,
      link: "/contracts/partners",
    });
    const call = (t: string, u: string, rows: object[]) =>
      as(t, u, (tx) =>
        tx`select hub.cc_notify(${batch(rows)}::text::jsonb) as n`.then((r) => r[0]?.n as number),
      );
    // A → C (kết nối): Cường nhận; Vy sai công ty; kind lạ; chính công ty mình.
    expect(
      await call(A, TIEN, [
        item(C, CUONG),
        item(C, VY),
        item(C, CUONG, "x.msg", "d2"),
        item(A, TIEN, "cc.msg", "d3"),
      ]),
    ).toBe(1);
    expect(await call(A, TIEN, [item(C, CUONG)])).toBe(0); // trùng dedup
    // B đã ngắt: A không gửi chuông cho B được nữa.
    expect(await call(A, TIEN, [item(B, DUNG, "cc.msg", "d4")])).toBe(0);
    // C (công ty thứ ba với A–F) không gửi được cho F.
    expect(await call(C, CUONG, [item(F, userId(1699), "cc.msg", "d5")])).toBe(0);
    expect(await bells(F)).toHaveLength(0);
    const cb = (await bells(C)).filter((b) => b.kind === "cc.msg");
    expect(cb).toHaveLength(1);
    expect(cb[0]?.user_id).toBe(CUONG);
    expect(cb[0]?.fanout_at).not.toBeNull();
    expect(
      (
        await fail(() =>
          call(
            A,
            TIEN,
            Array.from({ length: 501 }, () => item(C, CUONG)),
          ),
        )
      ).code,
    ).toBe("22023");
  });

  it("gọi thẳng mọi hàm công khai không đặt app.tenant_id ⇒ 42501", async () => {
    const calls: Array<(tx: Sql) => Promise<unknown>> = [
      (tx) => tx`select * from hub.cc_search('Preschool')`,
      (tx) => invite(tx, B, null, TIEN),
      (tx) => disconnect(tx, B),
      (tx) => links(tx),
      (tx) => connected(tx, A, B),
      (tx) => tx`select * from hub.cc_owner_users(array[${A}::uuid])`,
      (tx) => tx`select hub.cc_notify('[]'::jsonb)`,
      (tx) => accept(tx, A),
    ];
    for (const c of calls) expect((await fail(() => inHub("none", c))).code).toBe("42501");
    // Hàm nội bộ không gọi được từ hub_rw.
    expect(
      (
        await fail(() =>
          as(A, TIEN, (tx) => tx`select * from hub.cc_owners_raw(array[${A}::uuid])`),
        )
      ).code,
    ).toBe("42501");
    expect(
      (
        await fail(() =>
          as(
            A,
            TIEN,
            (tx) => tx`select hub.cc_bell(${A}::uuid, null, 'cc.msg', 't', '', null, 'k')`,
          ),
        )
      ).code,
    ).toBe("42501");
  });
});
