// CR-169 · lát 2b · spec §3 (P3, P4, P8, P10, P12) · §5 (hub 0150, 0151; pack-contracts 0118) · tệp đính kèm + danh bạ người + công ty đã kết nối, ở tầng DB.
// Role thật `hub_api` (scope user). Người dùng KHÔNG là tham số hàm: mọi hàm đọc `app.user_id`.
// Công ty: A (NitiGroup) — B (Preschool) đã kết nối; C kết nối với A, KHÔNG với B (công ty thứ ba); E không quan hệ.
// N2: Vy (nhân viên, KHÔNG phải người mời kết nối — Tiên mời) tải tệp cho Hà (nhân viên B, không phải người đồng ý — Dung đồng ý).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { department, enablePack, members, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, inHub, openOwner, type Sql } from "@ai/test-kit/db";

const A = tenantId(1700);
const B = tenantId(1701);
const C = tenantId(1702);
const E = tenantId(1703);
const TIEN = userId(1700); // A · Toàn quyền (người mời kết nối)
const VY = userId(1701); // A · nhân viên (editor)
const LAN = userId(1702); // A · nhân viên (viewer)
const NOGRANT = userId(1703); // A · không có quyền gói contracts
const DUNG = userId(1704); // B · Toàn quyền (người đồng ý)
const HA = userId(1705); // B · nhân viên (viewer), chức vụ Kế toán trưởng
const HB = userId(1706); // B · nhân viên (viewer)
const EXT = userId(1707); // B · user external
const BNG = userId(1708); // B · không có quyền gói contracts
const CUONG = userId(1709); // C · Toàn quyền
const EVA = userId(1710); // E · Toàn quyền
const ORG = "a1700000-0000-4000-8000-000000000001";
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
type Sent = { seq: string; created: boolean; message: { files: { id: string }[] } };
type Person = {
  user_id: string;
  name: string;
  job_title: string | null;
  tenant_id: string;
  company_name: string;
  department_id: string | null;
  department_name: string | null;
  sort_key: string;
};
type Company = { company_id: string; name: string; sort_key: string };

const invite = (tx: Sql, to: string, user: string) =>
  tx`select hub.cc_invite(${to}::uuid, null, ${user}::uuid, 'Mời') as s`.then(
    (r) => r[0]?.s as string,
  );
const accept = (tx: Sql, from: string) =>
  tx`select hub.partner_link_accept(${from}::uuid) as ok`.then((r) => r[0]?.ok as boolean);
const open = (tx: Sql, tenant: string, user: string) =>
  tx<{ id: string }[]>`select * from hub.pmsg_open(${tenant}::uuid, ${user}::uuid)`.then(
    (r) => (r[0] as { id: string }).id,
  );
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
const boxId = () => randomUUID().replace(/-/g, "").slice(0, 16); // FileBox: 16 hex
type FileArgs = { name?: string; mime?: string; size?: number; key?: string; box?: string };
/** Gọi `pmsg_file_add` đúng như route: id uuid do route sinh, khoá `<tenant bên tải>/<id>`. */
const addFile = (tx: Sql, tenant: string, thread: string, a: FileArgs = {}, id = randomUUID()) =>
  tx<{ f: { id: string; name: string; mime: string; size: number } }[]>`
    select hub.pmsg_file_add(${thread}::uuid, ${id}::uuid, ${a.box ?? boxId()}, ${a.name ?? "bao-gia.pdf"},
      ${a.mime ?? "application/pdf"}, ${a.size ?? 1234}::bigint, ${a.key ?? `${tenant}/${id}`}) as f`.then(
    (r) => (r[0] as { f: { id: string; name: string; mime: string; size: number } }).f,
  );
const getFile = (tx: Sql, thread: string, file: string) =>
  tx<
    { storage_key: string; box_file_id: string }[]
  >`select * from hub.pmsg_file_get(${thread}::uuid, ${file}::uuid)`.then((r) => [...r]);
const people = (
  tx: Sql,
  tenants: string[] | null = null,
  q: string | null = null,
  cur: { k: string; id: string } | null = null,
  limit = 50,
) =>
  tx<
    Person[]
  >`select * from hub.pmsg_people(${tenants === null ? null : tx.array(tenants)}::uuid[], ${q}::text,
    ${cur?.k ?? null}::text, ${cur?.id ?? null}::uuid, ${limit}::int)`.then((r) => [...r]);
const companies = (tx: Sql, cur: { k: string; id: string } | null = null, limit = 50) =>
  tx<
    Company[]
  >`select * from hub.pmsg_companies(${cur?.k ?? null}::text, ${cur?.id ?? null}::uuid, ${limit}::int)`.then(
    (r) => [...r],
  );
const disconnect = (from: string, user: string, other: string) =>
  as(from, user, (tx) => tx`select hub.cc_disconnect(${other}::uuid) as ok`.then((r) => r[0]?.ok));
const reconnect = async (inviter: [string, string], accepter: [string, string]) => {
  expect(await as(inviter[0], inviter[1], (tx) => invite(tx, accepter[0], inviter[1]))).toBe(
    "pending_out",
  );
  expect(await as(accepter[0], accepter[1], (tx) => accept(tx, inviter[0]))).toBe(true);
};

let vyHa = ""; // cuộc Vy (A) – Hà (B)
let lanHb = ""; // cuộc Lan (A) – Hb (B)

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  await o`insert into admin.tenants (id, key, name, legal_name, tax_code, directory_listed)
    values (${A}, 'pf-a', 'A', 'NitiGroup', '0100000401', true), (${B}, 'pf-b', 'B', 'Preschool Việt', '0100000402', true),
           (${C}, 'pf-c', 'C', 'Công ty Cờ', '0100000403', true), (${E}, 'pf-e', 'E', 'Công ty Ê', '0100000404', true)`;
  await users(o, A, 4, { from: 1700 }); // Tiên, Vy, Lan, NoGrant
  await users(o, B, 3, { from: 1704 }); // Dung, Hà, Hb
  await users(o, B, 1, { from: 1708 }); // BNG (không Group)
  await users(o, C, 1, { from: 1709 });
  await users(o, E, 1, { from: 1710 });
  await o`insert into admin.external_orgs (id, tenant_id, name) values (${ORG}, ${B}, 'NCC Ngoài')`;
  await o`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, kind, external_org_id, must_change_password)
    values (${EXT}, ${B}, 'ncc-ext', 'x', 'Nhà cung cấp ngoài', 'member', 'external', ${ORG}, false)`;
  const names: [string, string][] = [
    [TIEN, "Tiên Phạm"],
    [VY, "Vy Lê"],
    [LAN, "Lan Đỗ"],
    [NOGRANT, "Không Quyền"],
    [DUNG, "Dũng Trần"],
    [HA, "Hà Nguyễn"],
    [HB, "Hưng Bùi"],
    [BNG, "Bình Không Nhóm"],
    [CUONG, "Cường Võ"],
    [EVA, "Eva Ê"],
  ];
  for (const [u, n] of names) await o`update admin.users set display_name = ${n} where id = ${u}`;
  const g = await enablePack(o, [A, B, C, E], "contracts");
  await members(o, A, g.get(A)?.owner as string, [TIEN]);
  await members(o, A, g.get(A)?.editor as string, [VY]);
  await members(o, A, g.get(A)?.viewer as string, [LAN]);
  await members(o, B, g.get(B)?.owner as string, [DUNG]);
  await members(o, B, g.get(B)?.viewer as string, [HA, HB]);
  await members(o, C, g.get(C)?.owner as string, [CUONG]);
  await members(o, E, g.get(E)?.owner as string, [EVA]);
  await o`insert into hub.people_profiles (tenant_id, user_id, job_title) values (${B}, ${HA}, 'Kế toán trưởng')`;
  await o`insert into hub.people_profiles (tenant_id, user_id, job_title) values (${A}, ${VY}, 'Chuyên viên')`;
  await department(o, A, "kinh-doanh", { head: TIEN, members: [TIEN] });
  await reconnect([A, TIEN], [B, DUNG]); // Tiên mời — Dung đồng ý
  await reconnect([A, TIEN], [C, CUONG]);
  vyHa = await as(A, VY, (tx) => open(tx, B, HA));
  lanHb = await as(A, LAN, (tx) => open(tx, B, HB));
}, 90_000);
afterAll(async () => {
  await o?.end({ timeout: 2 });
});

describe("CR-169 · tệp (P3, P4): ghi, lấy, ai thấy", () => {
  it("Vy tải tệp lên cuộc với Hà: trả {id,name,mime,size}; chưa gắn tin ⇒ chỉ Vy lấy được (Hà, Dũng, Lan, Cường không)", async () => {
    const id = randomUUID();
    const bx = boxId();
    const f = await as(A, VY, (tx) =>
      addFile(tx, A, vyHa, { box: bx, name: "  bao-gia.pdf " }, id),
    );
    expect(f).toEqual({ id, name: "bao-gia.pdf", mime: "application/pdf", size: 1234 });
    expect(await as(A, VY, (tx) => getFile(tx, vyHa, id))).toEqual([
      { storage_key: `${A}/${id}`, box_file_id: bx },
    ]);
    for (const [t, u] of [
      [B, HA], // đầu kia của cuộc nhưng tệp chưa gắn tin
      [B, DUNG], // cùng công ty đầu kia, không phải một đầu
      [A, LAN], // cùng công ty người tải, không phải một đầu
      [C, CUONG], // công ty thứ ba
    ] as const) {
      expect([u, await as(t, u, (tx) => getFile(tx, vyHa, id))]).toEqual([u, []]);
    }
  });
  it("gắn vào tin ⇒ Hà lấy được; Dũng/Lan/Cường (không phải một đầu) vẫn không; sai cuộc ⇒ 0 dòng; Hà không gắn được tệp của Vy", async () => {
    const id = randomUUID();
    const bx = boxId();
    await as(A, VY, (tx) => addFile(tx, A, vyHa, { box: bx }, id));
    const hSend = await fail(() =>
      as(B, HA, (tx) => send(tx, vyHa, "tệp của người khác", randomUUID(), [id])),
    );
    expect([hSend.code, hSend.message]).toEqual(["CC422", "MSG_FILE_INVALID"]);
    const m = await as(A, VY, (tx) => send(tx, vyHa, "Báo giá đây", randomUUID(), [id]));
    expect(m.created).toBe(true);
    expect(m.message.files.map((x) => x.id)).toEqual([id]);
    const [row] = await o`select seq from hub.pmsg_files where id = ${id}`;
    expect(Number(row?.seq)).toBe(Number(m.seq));
    for (const [t, u] of [
      [A, VY],
      [B, HA],
    ] as const) {
      expect([u, await as(t, u, (tx) => getFile(tx, vyHa, id))]).toEqual([
        u,
        [{ storage_key: `${A}/${id}`, box_file_id: bx }],
      ]);
    }
    for (const [t, u] of [
      [B, DUNG],
      [A, LAN],
      [C, CUONG],
      [E, EVA],
    ] as const) {
      expect([u, await as(t, u, (tx) => getFile(tx, vyHa, id))]).toEqual([u, []]);
    }
    expect(await as(A, VY, (tx) => getFile(tx, lanHb, id))).toEqual([]); // sai cuộc (Vy không phải một đầu của lanHb)
    expect(await as(A, LAN, (tx) => getFile(tx, lanHb, id))).toEqual([]); // đúng đầu nhưng tệp thuộc cuộc khác
    expect(await as(A, VY, (tx) => getFile(tx, vyHa, randomUUID()))).toEqual([]);
  });
  it("công ty thứ ba / người ngoài cuộc không tải lên được ⇒ CC404 MSG_NOT_FOUND; không có quyền gói/external ⇒ 42501", async () => {
    for (const [t, u] of [
      [C, CUONG],
      [A, LAN],
      [B, DUNG],
    ] as const) {
      const f = await fail(() => as(t, u, (tx) => addFile(tx, t, vyHa)));
      expect([u, f.code, f.message]).toEqual([u, "CC404", "MSG_NOT_FOUND"]);
    }
    for (const [t, u] of [
      [A, NOGRANT],
      [B, EXT],
      [A, ""],
    ] as const) {
      const f = await fail(() => as(t, u, (tx) => addFile(tx, t, vyHa)));
      const g = await fail(() => as(t, u, (tx) => getFile(tx, vyHa, randomUUID())));
      expect([u, f.code, g.code]).toEqual([u, "42501", "42501"]);
    }
  });
  it("kiểm tên/mime/kích thước/khoá/box id trong hàm ⇒ CC422 MSG_FILE_INVALID (không phải 23514); đầu vào null ⇒ 22023", async () => {
    const id = randomUUID();
    const bad: [string, FileArgs][] = [
      ["tên rỗng", { name: "   " }],
      ["tên 256 ký tự", { name: "a".repeat(256) }],
      ["mime 101 ký tự", { mime: "m".repeat(101) }],
      ["size 0", { size: 0 }],
      ["size > 20 MB", { size: 20971521 }],
      ["khoá sai tenant", { key: `${B}/${id}` }],
      ["khoá sai id", { key: `${A}/${randomUUID()}` }],
      ["box id có dấu /", { box: "a/b" }],
      ["box id rỗng", { box: "" }],
      ["box id 65 ký tự", { box: "x".repeat(65) }],
    ];
    for (const [what, a] of bad) {
      const f = await fail(() => as(A, VY, (tx) => addFile(tx, A, vyHa, a, id)));
      expect([what, f.code, f.message]).toEqual([what, "CC422", "MSG_FILE_INVALID"]);
    }
    for (const a of [{ name: "a".repeat(255) }, { size: 20971520 }, { size: 1 }]) {
      const f = await as(A, VY, (tx) => addFile(tx, A, vyHa, a));
      expect(f.id).toBeString();
    }
    const nul = await fail(() =>
      as(A, VY, (tx) => tx`select hub.pmsg_file_add(null, ${id}::uuid, 'abc', 'a', 'b', 1, 'x')`),
    );
    expect(nul.code).toBe("22023");
  });
  it("trần 50 tệp chưa gắn tin mỗi người: tệp thứ 51 ⇒ MSG_FILE_INVALID; người khác không bị ảnh hưởng; gắn tin giải phóng chỗ", async () => {
    // Lan: dựng 49 tệp chưa gắn bằng owner (đúng ràng buộc bảng), rồi dùng hàm cho tệp thứ 50 và 51.
    await o`insert into hub.pmsg_files (id, thread_id, tenant_id, user_id, name, mime, size, storage_key, box_file_id)
      select s.id, ${lanHb}::uuid, ${A}::uuid, ${LAN}::uuid, 'f.txt', 'text/plain', 10, ${A}::text || '/' || s.id::text, 'bx' || replace(s.id::text, '-', '')
        from (select gen_random_uuid() as id from generate_series(1, 49)) s`;
    const fifty = await as(A, LAN, (tx) => addFile(tx, A, lanHb));
    const over = await fail(() => as(A, LAN, (tx) => addFile(tx, A, lanHb)));
    expect([over.code, over.message]).toEqual(["CC422", "MSG_FILE_INVALID"]);
    expect((await as(A, VY, (tx) => addFile(tx, A, vyHa))).id).toBeString();
    await as(A, LAN, (tx) => send(tx, lanHb, "kèm tệp", randomUUID(), [fifty.id]));
    expect((await as(A, LAN, (tx) => addFile(tx, A, lanHb))).id).toBeString(); // còn 49 chưa gắn + 1 mới = 50 ⇒ được
    const over2 = await fail(() => as(A, LAN, (tx) => addFile(tx, A, lanHb)));
    expect(over2.message).toBe("MSG_FILE_INVALID");
  });
  it("sweep: chỉ scope system, ≥ 1 giờ; dọn tệp chưa gắn quá hạn, KHÔNG đụng tệp đã gắn tin; role người dùng ⇒ 42501", async () => {
    const old = await as(A, VY, (tx) => addFile(tx, A, vyHa));
    const bound = await as(A, VY, (tx) => addFile(tx, A, vyHa));
    await as(A, VY, (tx) => send(tx, vyHa, "tệp cũ đã gắn", randomUUID(), [bound.id]));
    await o`update hub.pmsg_files set created_at = now() - interval '3 hours' where id in (${old.id}, ${bound.id})`;
    const byUser = await fail(() =>
      as(A, VY, (tx) => tx`select * from hub.pmsg_files_sweep(interval '2 hours')`),
    );
    expect(byUser.code).toBe("42501");
    const tooShort = await fail(() =>
      inHub(
        { kind: "system" },
        (tx) => tx`select * from hub.pmsg_files_sweep(interval '30 minutes')`,
      ),
    );
    expect(tooShort.code).toBe("22023");
    const swept = await inHub(
      { kind: "system" },
      (tx) =>
        tx<
          { file_id: string; storage_key: string; box_file_id: string }[]
        >`select * from hub.pmsg_files_sweep(interval '2 hours')`,
    );
    expect(swept.map((r) => r.file_id)).toEqual([old.id]);
    expect(swept[0]?.storage_key).toBe(`${A}/${old.id}`);
    expect(await as(A, VY, (tx) => getFile(tx, vyHa, old.id))).toEqual([]); // đã dọn ⇒ không lấy được
    expect((await as(A, VY, (tx) => getFile(tx, vyHa, bound.id))).length).toBe(1);
    const again = await inHub(
      { kind: "system" },
      (tx) => tx`select * from hub.pmsg_files_sweep(interval '2 hours')`,
    );
    expect(again.length).toBe(0);
  });
});

describe("CR-169 · Minor 2a: gửi lặp sau ngắt trả tin cũ; sau ngắt tải/gửi mới ⇒ 409; tệp tin cũ vẫn lấy được", () => {
  it("Tiên ngắt A–B: Vy gửi lại CÙNG client_id ⇒ tin cũ (created=false, notify rỗng), client_id MỚI ⇒ CC409; tải tệp ⇒ CC409; Hà vẫn lấy được tệp cũ; nối lại ⇒ cuộc cũ", async () => {
    const f = await as(A, VY, (tx) => addFile(tx, A, vyHa));
    const cid = randomUUID();
    const first = await as(A, VY, (tx) => send(tx, vyHa, "gửi trước khi ngắt", cid, [f.id]));
    expect(first.created).toBe(true);
    expect(await disconnect(A, TIEN, B)).toBe(true);
    const again = await as(A, VY, (tx) => send(tx, vyHa, "gửi trước khi ngắt", cid, [f.id]));
    expect([again.created, again.seq]).toEqual([false, first.seq]);
    const viaHa = await fail(() => as(B, HA, (tx) => send(tx, vyHa, "mới", randomUUID())));
    const viaVy = await fail(() => as(A, VY, (tx) => send(tx, vyHa, "mới", randomUUID())));
    expect([viaHa.code, viaHa.message, viaVy.code, viaVy.message]).toEqual([
      "CC409",
      "MSG_NOT_CONNECTED",
      "CC409",
      "MSG_NOT_CONNECTED",
    ]);
    const up = await fail(() => as(A, VY, (tx) => addFile(tx, A, vyHa)));
    expect([up.code, up.message]).toEqual(["CC409", "MSG_NOT_CONNECTED"]);
    expect((await as(B, HA, (tx) => getFile(tx, vyHa, f.id))).length).toBe(1); // chỉ đọc: tệp tin cũ vẫn tải được
    expect(await as(B, DUNG, (tx) => getFile(tx, vyHa, f.id))).toEqual([]);
    await reconnect([A, TIEN], [B, DUNG]);
    expect(await as(A, VY, (tx) => open(tx, B, HA))).toBe(vyHa);
    expect((await as(A, VY, (tx) => send(tx, vyHa, "nối lại"))).created).toBe(true);
  });
  it("người kia bị khoá ⇒ tải tệp CC409 MSG_PEER_INACTIVE; mở khoá ⇒ tải lại được", async () => {
    await o`update admin.users set locked_by_tenant = true where id = ${HB}`;
    const f = await fail(() => as(A, LAN, (tx) => addFile(tx, A, lanHb)));
    expect([f.code, f.message]).toEqual(["CC409", "MSG_PEER_INACTIVE"]);
    await o`update admin.users set locked_by_tenant = false where id = ${HB}`;
    await o`update hub.pmsg_files set deleted_at = now() where user_id = ${LAN} and seq is null`; // dọn trần của Lan
    expect((await as(A, LAN, (tx) => addFile(tx, A, lanHb))).id).toBeString();
  });
});

describe("CR-169 · danh bạ (P8): chỉ người công ty ĐANG kết nối ∩ quyền Sổ Hợp Tác; không email/điện thoại, không external", () => {
  it("Vy (A) thấy người của A và B, C — trừ chính mình, người không có quyền gói, external, công ty không kết nối (E)", async () => {
    const rows = await as(A, VY, (tx) => people(tx));
    expect(rows.map((r) => r.user_id).sort()).toEqual([TIEN, LAN, DUNG, HA, HB, CUONG].sort());
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(
      [
        "company_name",
        "department_id",
        "department_name",
        "job_title",
        "name",
        "sort_key",
        "tenant_id",
        "user_id",
      ].sort(),
    );
    const ha = rows.find((r) => r.user_id === HA);
    expect([ha?.name, ha?.job_title, ha?.company_name, ha?.tenant_id]).toEqual([
      "Hà Nguyễn",
      "Kế toán trưởng",
      "Preschool Việt",
      B,
    ]);
    // sắp theo tên không dấu, thấp → cao
    const keys = rows.map((r) => r.sort_key);
    expect(keys).toEqual([...keys].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)));
  });
  it("phòng ban chỉ cho người của A; người công ty kia department = null", async () => {
    const rows = await as(A, VY, (tx) => people(tx));
    const tien = rows.find((r) => r.user_id === TIEN);
    expect(tien?.department_name).toBe("kinh-doanh");
    expect(tien?.department_id).toBeString();
    for (const r of rows.filter((x) => x.tenant_id !== A))
      expect([r.user_id, r.department_id, r.department_name]).toEqual([r.user_id, null, null]);
  });
  it("lọc p_tenants ∩ ({A} ∪ kết nối): công ty ngoài tập bị bỏ im lặng; mảng rỗng ⇒ rỗng", async () => {
    const only = async (t: string[] | null) =>
      (await as(A, VY, (tx) => people(tx, t))).map((r) => r.tenant_id);
    expect(new Set(await only([B]))).toEqual(new Set([B]));
    expect(await only([E])).toEqual([]); // E không kết nối: không lỗi, không lộ
    expect(new Set(await only([B, E, C]))).toEqual(new Set([B, C]));
    expect(await only([])).toEqual([]);
    expect(new Set(await only([A]))).toEqual(new Set([A]));
  });
  it("q khớp tên HOẶC chức vụ, không phân biệt hoa/dấu; ký tự % _ \\ không là ký tự đại diện", async () => {
    const ids = async (q: string) =>
      (await as(A, VY, (tx) => people(tx, null, q))).map((r) => r.user_id);
    expect(await ids("KE TOAN")).toEqual([HA]); // chức vụ «Kế toán trưởng»
    expect(await ids("ha nguyen")).toEqual([HA]); // tên «Hà Nguyễn»
    expect(await ids("cuong")).toEqual([CUONG]);
    expect(await ids("%")).toEqual([]);
    expect(await ids("_")).toEqual([]);
    expect(await ids("\\")).toEqual([]);
    expect(await ids("không tồn tại")).toEqual([]);
  });
  it("keyset (sort_key, user_id): trang nhỏ ghép lại = danh sách đầy đủ, không lặp/sót; limit kẹp", async () => {
    const all = await as(A, VY, (tx) => people(tx));
    const got: Person[] = [];
    let cur: { k: string; id: string } | null = null;
    for (let i = 0; i < 10; i++) {
      const c: { k: string; id: string } | null = cur;
      const pg = await as(A, VY, (tx) => people(tx, null, null, c, 2));
      if (pg.length === 0) break;
      expect(pg.length).toBeLessThanOrEqual(2);
      got.push(...pg);
      const last = pg[pg.length - 1] as Person;
      cur = { k: last.sort_key, id: last.user_id };
    }
    expect(got.map((r) => r.user_id)).toEqual(all.map((r) => r.user_id));
    expect((await as(A, VY, (tx) => people(tx, null, null, null, 0))).length).toBe(1); // kẹp ≥ 1
    expect((await as(A, VY, (tx) => people(tx, null, null, null, 9999))).length).toBe(all.length);
  });
  it("Hà (B) thấy A, B, C? Không: C không kết nối với B ⇒ chỉ A và B; Eva (E, không kết nối ai) chỉ thấy công ty mình", async () => {
    const ha = await as(B, HA, (tx) => people(tx));
    expect(new Set(ha.map((r) => r.tenant_id))).toEqual(new Set([A, B]));
    expect(ha.map((r) => r.user_id)).not.toContain(CUONG);
    expect(ha.map((r) => r.user_id)).not.toContain(BNG);
    expect(ha.map((r) => r.user_id)).not.toContain(EXT);
    expect(ha.map((r) => r.user_id)).not.toContain(HA);
    expect(await as(E, EVA, (tx) => people(tx))).toEqual([]);
  });
  it("người bị khoá / mất quyền gói / bị gỡ Group không còn trong danh bạ; mở lại thì có", async () => {
    await o`update admin.users set locked_by_tenant = true where id = ${HB}`;
    expect((await as(A, VY, (tx) => people(tx))).map((r) => r.user_id)).not.toContain(HB);
    await o`update admin.users set locked_by_tenant = false where id = ${HB}`;
    expect((await as(A, VY, (tx) => people(tx))).map((r) => r.user_id)).toContain(HB);
    await o`update admin.users set active = false where id = ${HB}`;
    expect((await as(A, VY, (tx) => people(tx))).map((r) => r.user_id)).not.toContain(HB);
    await o`update admin.users set active = true where id = ${HB}`;
  });
  it("ngắt kết nối A–C ⇒ người C biến khỏi danh bạ và danh sách công ty; kết nối lại ⇒ có lại; không có quyền gói/external ⇒ 42501", async () => {
    expect(await disconnect(A, TIEN, C)).toBe(true);
    expect((await as(A, VY, (tx) => people(tx))).map((r) => r.user_id)).not.toContain(CUONG);
    expect((await as(A, VY, (tx) => people(tx, [C]))).length).toBe(0);
    expect((await as(A, VY, (tx) => companies(tx))).map((r) => r.company_id)).toEqual([B]);
    await reconnect([A, TIEN], [C, CUONG]);
    expect((await as(A, VY, (tx) => people(tx))).map((r) => r.user_id)).toContain(CUONG);
    for (const [t, u] of [
      [A, NOGRANT],
      [B, EXT],
      [A, ""],
    ] as const) {
      const p = await fail(() => as(t, u, (tx) => people(tx)));
      const c = await fail(() => as(t, u, (tx) => companies(tx)));
      expect([u, p.code, c.code]).toEqual([u, "42501", "42501"]);
    }
  });
});

describe("CR-169 · danh sách công ty (P10): chỉ công ty đang kết nối, theo tên, cursor", () => {
  it("Vy thấy B và C theo tên không dấu (Công ty Cờ trước Preschool Việt); không có A, E; phân trang con trỏ", async () => {
    const rows = await as(A, VY, (tx) => companies(tx));
    expect(rows.map((r) => [r.company_id, r.name])).toEqual([
      [C, "Công ty Cờ"],
      [B, "Preschool Việt"],
    ]);
    const p1 = await as(A, VY, (tx) => companies(tx, null, 1));
    expect(p1.map((r) => r.company_id)).toEqual([C]);
    const first = p1[0] as Company;
    const p2 = await as(A, VY, (tx) =>
      companies(tx, { k: first.sort_key, id: first.company_id }, 1),
    );
    expect(p2.map((r) => r.company_id)).toEqual([B]);
    const second = p2[0] as Company;
    expect(
      await as(A, VY, (tx) => companies(tx, { k: second.sort_key, id: second.company_id }, 1)),
    ).toEqual([]);
    expect((await as(B, HA, (tx) => companies(tx))).map((r) => r.company_id)).toEqual([A]); // B không kết nối C
    expect(await as(E, EVA, (tx) => companies(tx))).toEqual([]);
  });
});

describe("CR-169 · P12 / 0151: quyền hàm", () => {
  const PUBLIC_FNS = [
    "hub.pmsg_open(uuid, uuid)",
    "hub.pmsg_inbox(uuid, timestamptz, uuid, integer)",
    "hub.pmsg_detail(uuid)",
    "hub.pmsg_page(uuid, bigint, integer)",
    "hub.pmsg_send(uuid, uuid, text, uuid[])",
    "hub.pmsg_delete(uuid, bigint)",
    "hub.pmsg_mark_read(uuid, bigint)",
    "hub.pmsg_unread()",
    "hub.pmsg_file_add(uuid, uuid, text, text, text, bigint, text)",
    "hub.pmsg_file_get(uuid, uuid)",
    "hub.pmsg_people(uuid[], text, text, uuid, integer)",
    "hub.pmsg_companies(text, uuid, integer)",
  ];
  const INTERNAL = [
    "hub.pmsg_ctx()",
    "hub.pmsg_eligible_raw(uuid, uuid)",
    "hub.pmsg_msg_json(hub.pmsg_messages)",
    "hub.pmsg_view(uuid, uuid, uuid)",
    "hub.pmsg_connected(uuid)",
  ];
  const SWEEP = "hub.pmsg_files_sweep(interval)";
  const can = async (role: string, fn: string) => {
    const [r] = await o.unsafe(
      `select has_function_privilege('${role}', '${fn}', 'execute') as ok`,
    );
    return r?.ok as boolean;
  };
  it("chỉ hub_rw + contracts_rw gọi được hàm công khai; hàm nội bộ không ai; sweep chỉ hub_rw; role khác (PUBLIC, *_rw còn lại) không có gì", async () => {
    for (const fn of PUBLIC_FNS) {
      expect([
        fn,
        await can("hub_rw", fn),
        await can("contracts_rw", fn),
        await can("public", fn),
      ]).toEqual([fn, true, true, false]);
    }
    expect([
      await can("hub_rw", SWEEP),
      await can("contracts_rw", SWEEP),
      await can("public", SWEEP),
    ]).toEqual([true, false, false]);
    const others = (
      await o`select rolname from pg_roles where rolname like '%\\_rw' and rolname not in ('hub_rw', 'contracts_rw') and not rolsuper`
    ).map((r) => r.rolname as string);
    for (const role of others) {
      for (const fn of [...PUBLIC_FNS, SWEEP, ...INTERNAL]) {
        expect([role, fn, await can(role, fn)]).toEqual([role, fn, false]);
      }
    }
    for (const fn of INTERNAL) {
      expect([
        fn,
        await can("hub_rw", fn),
        await can("contracts_rw", fn),
        await can("public", fn),
      ]).toEqual([fn, false, false, false]);
    }
  });
  it("người dùng thường không gọi được hàm nội bộ (kể cả pmsg_connected)", async () => {
    const f = await fail(() =>
      as(A, VY, (tx) => tx.unsafe(`select * from hub.pmsg_connected('${A}'::uuid)`)),
    );
    expect(f.code).toBe("42501");
  });
});
