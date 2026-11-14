// CR-161 · lát 4 · spec §2 R10 · community 0020 `community.cc_posts`: công ty ĐÃ KẾT NỐI đọc bài Bảng tin công khai của nhau (chữ + số tệp).
// Role thật `community_rw` (đúng `withPackScope`). Ngắt/chặn/chưa kết nối/công ty thứ ba ⇒ 42501; không lộ bài không công khai, trường *_raw, tệp.
// N2: người xem (Tiên, A) KHÔNG phải người đăng bài của B.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenantId, userId } from "@ai/test-kit/builders";
import { cloneDb, inPackAs, openOwner, pgCode, type Sql } from "@ai/test-kit/db";

const A = tenantId(1620);
const B = tenantId(1621);
const C = tenantId(1622); // công ty thứ ba (không kết nối ai)
const D = tenantId(1623); // chỉ A→D accepted, D→A chưa (chưa kết nối)
const E = tenantId(1624); // đã kết nối với A rồi bị ngắt (xoá dòng)
const F = tenantId(1625); // A chặn F
const G = tenantId(1626); // kết nối với A nhưng chưa đăng bài nào
const TIEN = userId(1620); // A
const POSTER = userId(1621); // người đăng ở B (khác người xem)
let o: Sql;

type Row = {
  id: string;
  type: string;
  title_masked: string;
  body_masked: string;
  fields_masked: Record<string, unknown>;
  cats: string[];
  edited: boolean;
  created_at: Date;
  expires_at: Date;
  media_count: number;
};
const view = (
  t: string,
  other: string,
  limit = 20,
  at: Date | null = null,
  id: string | null = null,
) =>
  inPackAs(
    "community",
    t,
    TIEN,
    (tx) =>
      tx<
        Row[]
      >`select * from community.cc_posts(${other}::uuid, ${at}::timestamptz, ${id}::uuid, ${limit}::int)`,
  );
const titles = (rows: Row[]) => rows.map((r) => r.title_masked);
const ids: Record<string, string> = {};

type Opt = {
  org?: string | null;
  aud?: string;
  status?: string;
  hidden?: boolean;
  ageDays?: number;
  expired?: boolean;
};

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  const link = (f: string, t: string, blocked = false) =>
    o`insert into hub.partner_links (from_tenant, to_tenant, accepted_at, blocked_at)
      values (${f}, ${t}, now(), ${blocked ? new Date() : null})`;
  await link(A, B);
  await link(B, A);
  await link(A, D); // một chiều
  await link(A, E);
  await link(E, A);
  await link(A, F, true);
  await link(F, A);
  await link(A, G);
  await link(G, A);
  await o`delete from hub.partner_links where (from_tenant = ${A} and to_tenant = ${E}) or (from_tenant = ${E} and to_tenant = ${A})`; // E: đã ngắt
  const mk = async (tenant: string, key: string, m: Opt = {}): Promise<string> => {
    const org = m.org ?? null;
    const aud = org ? null : (m.aud ?? "all");
    const exp = new Date(Date.now() + (m.expired ? -3_600_000 : 30 * 86_400_000));
    const born = new Date(Date.now() - (m.ageDays ?? 0) * 86_400_000);
    const r = await o<{ id: string }[]>`insert into community.posts
      (tenant_id, type, author_user_id, author_name, author_org, status, hidden,
       title_raw, title_masked, body_raw, body_masked, fields_raw, fields_masked, hits, cats, aud_mode, created_at, expires_at)
      values (${tenant}, 'sell', ${POSTER}, 'Tên người đăng', ${org}, ${m.status ?? "active"}, ${m.hidden ?? false},
        ${`RAW-${key}`}, ${key}, ${`SĐT 0912345678 ${key}`}, ${`SĐT *** ${key}`},
        ${o.json({ phone: "0912345678" })}, ${o.json({ phone: "***" })}, ${o.json([{ rule: "phone" }])},
        ${o.array(["dong-goi"])}, ${aud}, ${born}, ${exp})
      returning id`;
    return r[0]?.id as string;
  };
  ids.new = await mk(B, "pub_new");
  ids.old = await mk(B, "pub_old", { ageDays: 2 });
  await mk(B, "aud_suppliers", { aud: "suppliers" });
  await mk(B, "partner_post", { org: crypto.randomUUID() });
  await mk(B, "archived", { status: "archived" });
  await mk(B, "hidden", { hidden: true });
  await mk(B, "expired", { expired: true });
  await mk(A, "a_pub");
  await mk(E, "e_pub");
  await mk(F, "f_pub");
  await mk(D, "d_pub");
  await mk(C, "c_pub");
  await o`insert into community.media (tenant_id, post_id, kind, position, label, url)
    values (${B}, ${ids.new as string}, 'image', 0, 'a', 'https://x/1'), (${B}, ${ids.new as string}, 'image', 1, 'b', 'https://x/2')`;
}, 60_000);
afterAll(async () => {
  await o?.end({ timeout: 2 });
});

describe("CR-161 · R10 xem bài Bảng tin công ty đã kết nối", () => {
  it("đã kết nối ⇒ thấy đúng bài công khai (mới → cũ), kèm số tệp; không lộ bài không công khai/đối tác/ẩn/hết hạn/lưu trữ", async () => {
    const rows = await view(A, B);
    expect(titles(rows)).toEqual(["pub_new", "pub_old"]);
    expect(rows.map((r) => r.media_count)).toEqual([2, 0]);
  });

  it("che trường nội bộ: chỉ cột đã che, không có *_raw/hits/tác giả/audience/status; nội dung là bản che", async () => {
    const rows = await view(A, B);
    expect(Object.keys(rows[0] as Row).sort()).toEqual(
      [
        "body_masked",
        "cats",
        "created_at",
        "edited",
        "expires_at",
        "fields_masked",
        "id",
        "media_count",
        "title_masked",
        "type",
      ].sort(),
    );
    expect(rows[0]?.body_masked).toBe("SĐT *** pub_new");
    expect(rows[0]?.fields_masked).toEqual({ phone: "***" });
    expect(JSON.stringify(rows)).not.toContain("0912345678");
    expect(JSON.stringify(rows)).not.toContain("RAW-");
  });

  it("đối xứng: B xem được bài của A; bài của chính mình không lẫn vào", async () => {
    expect(titles(await view(B, A))).toEqual(["a_pub"]);
  });

  it("chưa kết nối (một chiều) / đang chặn / công ty thứ ba ⇒ 42501", async () => {
    expect(await pgCode(() => view(A, D))).toBe("42501"); // A mời D, D chưa đồng ý
    expect(await pgCode(() => view(D, A))).toBe("42501");
    expect(await pgCode(() => view(A, F))).toBe("42501"); // bị chặn
    expect(await pgCode(() => view(C, B))).toBe("42501"); // C không liên quan
    expect(await pgCode(() => view(C, A))).toBe("42501"); // A–B kết nối không kéo theo C
    expect(await pgCode(() => view(A, C))).toBe("42501");
  });

  it("ngắt kết nối ⇒ mất ngay: 42501; mỗi lần gọi kiểm lại", async () => {
    expect(await pgCode(() => view(A, E))).toBe("42501"); // E đã ngắt
    expect(await pgCode(() => view(E, A))).toBe("42501");
    expect(titles(await view(A, B))).toHaveLength(2);
    await o`update hub.partner_links set accepted_at = null where from_tenant = ${B} and to_tenant = ${A}`;
    expect(await pgCode(() => view(A, B))).toBe("42501");
    await o`update hub.partner_links set accepted_at = now() where from_tenant = ${B} and to_tenant = ${A}`;
    expect(titles(await view(A, B))).toHaveLength(2);
  });

  it("đã kết nối nhưng chưa có bài ⇒ rỗng (không lỗi); công ty không hợp lệ ⇒ 22023; chưa đặt tenant ⇒ 42501", async () => {
    expect((await view(A, G)).length).toBe(0);
    expect(await pgCode(() => view(A, A))).toBe("22023");
    expect(await pgCode(() => view("", B))).toBe("42501");
  });

  it("RLS bảng không đổi: truy vấn trực tiếp community.posts/media của A không thấy dòng của B", async () => {
    const n = await inPackAs(
      "community",
      A,
      TIEN,
      (tx) => tx`select count(*)::int as n from community.posts where tenant_id = ${B}`,
    );
    expect(n[0]?.n).toBe(0);
    const m = await inPackAs(
      "community",
      A,
      TIEN,
      (tx) => tx`select count(*)::int as n from community.media where tenant_id = ${B}`,
    );
    expect(m[0]?.n).toBe(0);
  });

  it("phân trang keyset: limit 1 rồi trang sau; limit kẹp 1..101", async () => {
    const p1 = await view(A, B, 1);
    expect(titles(p1)).toEqual(["pub_new"]);
    const first = p1[0] as Row;
    const p2 = await view(A, B, 1, first.created_at, first.id);
    expect(titles(p2)).toEqual(["pub_old"]);
    const last = p2[0] as Row;
    expect((await view(A, B, 1, last.created_at, last.id)).length).toBe(0);
    expect(titles(await view(A, B, 0))).toEqual(["pub_new"]); // 0 ⇒ kẹp lên 1
  });
});
