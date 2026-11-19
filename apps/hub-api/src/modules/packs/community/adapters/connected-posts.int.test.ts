// CR-191 · lát cr191-feed-merge-rls · BR-191-1/2/3 · bảng tin GỘP — phần bài của công ty ĐÃ KẾT NỐI qua `community.feed_connected`
// (community 0026, DEFINER) + `hub.cc_connected_ids()` (hub 0163). Thay `community.cc_posts` của CR-161 (đã gỡ — G1; nghĩa test đổi theo spec
// CR-191: không còn «xem bảng tin của MỘT công ty», mà một dòng gộp mọi công ty kết nối có công ty mình trong «Ai thấy bài»).
// Role thật `community_rw` (đúng `withPackScope`). N2: người xem (Vy ở B) KHÔNG phải người đăng (Poster ở A), không phải quản trị.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, inPackAs, openOwner, pgCode, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { TRUTH } from "../../../../../../../tests/acceptance/com-c3/_support/audience-truth";
import { createPackUow } from "../../kit/public";
import { mergeNewest } from "../domain/feed-merge.rules";
import type { Access } from "./community-access";
import { feed } from "./post.service";
import { connectedView } from "./views";

const A = tenantId(1620); // công ty đăng
const B = tenantId(1621); // công ty đã kết nối với A (người xem)
const C = tenantId(1622); // công ty thứ ba, không kết nối ai
const D = tenantId(1623); // A mời D, D chưa đồng ý (một chiều)
const F = tenantId(1625); // A chặn F
const P = tenantId(1627); // công ty đăng cho bảng chân trị
const T1 = "00000000-0000-4000-8000-0000000000a1"; // = IDS.T1 bảng chân trị
const T2 = "00000000-0000-4000-8000-0000000000a2";
const POSTER = userId(1621); // người đăng ở A
const VY = userId(1622); // nhân viên B (không phải người đăng, không phải quản trị)
const MST_B = "0100000621";
const MST = { [T1]: "0100000911", [T2]: "0100000912-001" } as Record<string, string>;
let o: Sql;
let db: Db;

type Row = {
  id: string;
  tenant_id: string;
  company_name: string;
  type: string;
  title_masked: string;
  body_masked: string;
  fields_masked: Record<string, unknown>;
  created_at: Date;
  file_count: number;
  author_name: string;
  author_title: string | null;
};
const fc = (
  t: string,
  u = VY,
  o2: {
    limit?: number;
    at?: Date | null;
    id?: string | null;
    type?: string | null;
    src?: string | null;
  } = {},
) =>
  inPackAs(
    "community",
    t,
    u,
    (tx) =>
      tx<
        Row[]
      >`select * from community.feed_connected(${o2.at ?? null}::timestamptz, ${o2.id ?? null}::uuid,
        ${o2.limit ?? 20}::int, ${o2.type ?? null}::text, ${o2.src ?? null}::uuid)`,
  );
const titles = (rows: Row[]) => rows.map((r) => r.title_masked);

type Opt = {
  org?: string | null;
  aud?: string;
  tenants?: string[];
  orgs?: string[];
  type?: string;
  status?: string;
  hidden?: boolean;
  moderation?: string;
  ageMin?: number;
  expired?: boolean;
};
const mk = async (tenant: string, key: string, m: Opt = {}): Promise<string> => {
  const org = m.org ?? null;
  const aud = org ? null : (m.aud ?? "all");
  const exp = new Date(Date.now() + (m.expired ? -3_600_000 : 30 * 86_400_000));
  const born = new Date(Date.now() - (m.ageMin ?? 0) * 60_000);
  const r = await o<{ id: string }[]>`insert into community.posts
    (tenant_id, type, author_user_id, author_name, author_org, status, hidden, moderation,
     title_raw, title_masked, body_raw, body_masked, fields_raw, fields_masked, hits, cats, aud_mode, aud_orgs, aud_tenants,
     created_at, expires_at)
    values (${tenant}, ${m.type ?? "sell"}, ${POSTER}, 'Lan Poster', ${org}, ${m.status ?? "active"}, ${m.hidden ?? false},
      ${m.moderation ?? "none"},
      ${`RAW-${key}`}, ${key}, ${`SĐT 0912345678 ${key}`}, ${`SĐT *** ${key}`},
      ${o.json({ phone: "0912345678" })}, ${o.json({ phone: "***" })}, ${o.json([{ rule: "phone" }])},
      ${o.array(["dong-goi"])}, ${aud}, ${o.array(m.orgs ?? [])}::uuid[], ${o.array(m.tenants ?? [])}::uuid[], ${born}, ${exp})
    returning id`;
  return r[0]?.id as string;
};
const link = (f: string, t: string, blocked = false) =>
  o`insert into hub.partner_links (from_tenant, to_tenant, accepted_at, blocked_at)
    values (${f}, ${t}, now(), ${blocked ? new Date() : null})`;
const roles = async (owner: string, viewer: string, rs: string[]) => {
  const key = `tax:${(MST[viewer] ?? MST_B).replace(/[^0-9]/g, "")}`;
  await o`delete from contracts.partner_roles where tenant_id = ${owner} and party_key = ${key}`;
  for (const r of rs)
    await o`insert into contracts.partner_roles (tenant_id, party_key, role, name) values (${owner}, ${key}, ${r}, 'x')`;
};
const ids: Record<string, string> = {};

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  await link(A, B);
  await link(B, A);
  await link(A, D);
  await link(A, F, true);
  await link(F, A);
  for (const t of [T1, T2]) {
    await link(P, t);
    await link(t, P);
  }
  await o`insert into admin.tenants (id, key, name, legal_name, tax_code)
    select t.id, 'fc' || t.n, 'fc' || t.n, t.ln, t.mst from unnest(${o.array([A, B, C, D, F, P, T1, T2])}::uuid[],
      ${o.array(["Công ty A Đăng", "B", "C", "D", "F", "P", "T1", "T2"])}::text[],
      ${o.array(["0100000620", MST_B, "0100000622", "0100000623", "0100000625", "0100000627", MST[T1] as string, MST[T2] as string])}::text[])
      with ordinality as t(id, ln, mst, n)`;
  await o`insert into admin.feature_entitlements (feature_id, tenant_id)
    select f.id, t from admin.features f, unnest(${o.array([A, B, C, D, F, P, T1, T2])}::uuid[]) t where f.key = 'contracts-community'
    on conflict (feature_id, tenant_id) do update set revoked_at = null`;
  await o`insert into hub.people_profiles (tenant_id, user_id, job_title) values (${A}, ${POSTER}, 'Trưởng phòng mua hàng')`;
  ids.new = await mk(A, "all_new");
  ids.old = await mk(A, "all_old", { ageMin: 60, type: "buy" });
  await mk(A, "internal", { aud: "internal" });
  await mk(A, "cats", { aud: "cats" });
  await mk(A, "companies_B", { aud: "companies", tenants: [B], ageMin: 5 });
  await mk(A, "companies_other", { aud: "companies", tenants: [C] });
  await mk(A, "companies_orgB", { aud: "companies", orgs: [B] }); // id ở aud_orgs (ext_org) không áp chéo
  await mk(A, "suppliers", { aud: "suppliers", ageMin: 10 });
  await mk(A, "buyers", { aud: "buyers", ageMin: 15 });
  await mk(A, "partner_post", { org: crypto.randomUUID() });
  await mk(A, "archived", { status: "archived" });
  await mk(A, "hidden", { hidden: true });
  await mk(A, "expired", { expired: true });
  await mk(A, "pending", { moderation: "pending" });
  await mk(B, "b_own");
  await mk(C, "c_pub");
  await mk(D, "d_pub");
  await mk(F, "f_pub");
  await o`insert into community.media (tenant_id, post_id, kind, position, label, url)
    values (${A}, ${ids.new as string}, 'image', 0, 'a', 'https://x/1'), (${A}, ${ids.new as string}, 'image', 1, 'b', 'https://x/2')`;
  // bảng chân trị: một bài mỗi mức ở P
  const specs = new Map<string, (typeof TRUTH)[number]>();
  for (const r of TRUTH) specs.set(r.name.split(" × ")[0] as string, r);
  for (const [name, r] of specs)
    await mk(P, `truth:${name}`, {
      aud: r.aud.mode,
      tenants: r.aud.tenants,
      orgs: r.aud.companies,
      type: r.type,
    });
  await users(o, B, 1, { from: 1622 }); // Vy: người dùng nội bộ thật của B (bảng tin công ty mình đi qua RLS người xem)
  db = createDb(urls().hubApi, { max: 2 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-191 · bảng tin gộp: bài công ty đã kết nối (feed_connected)", () => {
  it("B (Vy, không phải người đăng) thấy bài A «Tất cả đối tác» + bài chọn đích danh B, không thấy Chỉ nội bộ / nhóm hàng / công ty khác", async () => {
    await roles(A, B, []);
    const rows = await fc(B);
    expect(titles(rows)).toEqual(["all_new", "companies_B", "all_old"]);
    expect(rows[0]?.file_count).toBe(2);
    expect(rows[0]?.company_name).toBe("Công ty A Đăng");
    expect(rows[0]?.author_name).toBe("Lan Poster");
    expect(rows[0]?.author_title).toBe("Trưởng phòng mua hàng");
    expect(new Set(rows.map((r) => r.tenant_id))).toEqual(new Set([A]));
  });

  it("Nhà cung cấp / Khách hàng theo nhãn vai của B trong sổ đối tác của A (khoá MST)", async () => {
    await roles(A, B, ["supplier"]);
    expect(titles(await fc(B))).toEqual(["all_new", "companies_B", "suppliers", "all_old"]);
    await roles(A, B, ["customer"]);
    expect(titles(await fc(B))).toEqual(["all_new", "companies_B", "buyers", "all_old"]);
    await roles(A, B, ["commission_payer"]);
    expect(titles(await fc(B))).toEqual(["all_new", "companies_B", "all_old"]);
    await roles(A, B, []);
  });

  it("khớp bảng chân trị (mọi hàng người xem công ty kết nối)", async () => {
    const rows = TRUTH.filter((r) => r.viewer.kind === "connected");
    const byViewer = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = r.name.split(" × ")[1] as string;
      byViewer.set(k, [...(byViewer.get(k) ?? []), r]);
    }
    expect(byViewer.size).toBe(5);
    for (const [, list] of byViewer) {
      const v = list[0]?.viewer as { kind: "connected"; tenantId: string; labels: string[] };
      await roles(P, v.tenantId, v.labels);
      const seen = new Set(titles(await fc(v.tenantId, VY, { src: P, limit: 101 })));
      for (const r of list)
        expect([r.name, seen.has(`truth:${r.name.split(" × ")[0]}`)]).toEqual([r.name, r.want]);
    }
  });

  it("che trường nội bộ: không *_raw/hits/aud_*/status/hidden; nội dung là bản che", async () => {
    const rows = await fc(B);
    expect(Object.keys(rows[0] as Row).sort()).toEqual(
      [
        "author_name",
        "author_title",
        "body_masked",
        "cats",
        "company_name",
        "created_at",
        "edited",
        "expires_at",
        "fields_masked",
        "file_count",
        "id",
        "tenant_id",
        "title_masked",
        "type",
      ].sort(),
    );
    expect(JSON.stringify(rows)).not.toContain("0912345678");
    expect(JSON.stringify(rows)).not.toContain("RAW-");
  });

  it("công ty thứ ba / một chiều / bị chặn ⇒ không thấy gì, bài chính mình không lẫn vào", async () => {
    expect((await fc(C)).length).toBe(0);
    expect((await fc(D)).length).toBe(0);
    expect(titles(await fc(A))).toEqual(["b_own"]); // A thấy bài B; không thấy D/F/C, không thấy bài mình
  });

  it("ngắt kết nối ⇒ biến mất ở lần gọi kế, nối lại ⇒ hiện lại (không cache)", async () => {
    expect((await fc(B)).length).toBe(3);
    await o`update hub.partner_links set accepted_at = null where from_tenant = ${A} and to_tenant = ${B}`;
    expect((await fc(B)).length).toBe(0);
    await o`update hub.partner_links set accepted_at = now() where from_tenant = ${A} and to_tenant = ${B}`;
    expect((await fc(B)).length).toBe(3);
  });

  it("lọc loại bài + một công ty; phân trang keyset; limit kẹp 1..101", async () => {
    expect(titles(await fc(B, VY, { type: "buy" }))).toEqual(["all_old"]);
    expect(await pgCode(() => fc(B, VY, { type: "x" }))).toBe("22023");
    expect(titles(await fc(B, VY, { src: C }))).toEqual([]);
    const p1 = await fc(B, VY, { limit: 1 });
    expect(titles(p1)).toEqual(["all_new"]);
    const p2 = await fc(B, VY, { limit: 1, at: p1[0]?.created_at, id: p1[0]?.id });
    expect(titles(p2)).toEqual(["companies_B"]);
    expect(titles(await fc(B, VY, { limit: 0 }))).toEqual(["all_new"]);
  });

  it("người dùng ngoài ⇒ 42501, chưa đặt người xem ⇒ 42501, A tắt Bảng tin ⇒ rỗng", async () => {
    const ext = await pgCode(() =>
      inPackAs("community", B, VY, async (tx) => {
        await tx`select set_config('app.user_kind', 'external', true)`;
        return tx`select * from community.feed_connected(null, null, 20, null, null)`;
      }),
    );
    expect(ext).toBe("42501");
    expect(await pgCode(() => fc(""))).toBe("42501");
    const set = (on: boolean) =>
      o`update admin.feature_entitlements e set revoked_at = ${on ? null : new Date()}
        from admin.features f where f.id = e.feature_id and f.key = 'contracts-community' and e.tenant_id = ${A}`;
    await set(false);
    expect((await fc(B)).length).toBe(0);
    await set(true);
    expect((await fc(B)).length).toBe(3);
  });

  it("hub.cc_connected_ids: đúng tập hai chiều; RLS bảng không đổi (B không đọc trực tiếp bài A); cc_posts đã gỡ", async () => {
    const got = await inPackAs(
      "community",
      A,
      VY,
      (tx) => tx<{ t: string }[]>`select t::text from hub.cc_connected_ids() t`,
    );
    expect(got.map((r) => r.t)).toEqual([B]);
    const n = await inPackAs(
      "community",
      B,
      VY,
      (tx) => tx`select count(*)::int as n from community.posts where tenant_id = ${A}`,
    );
    expect(n[0]?.n).toBe(0);
    expect(
      await o`select 1 from pg_proc where proname = 'cc_posts' and pronamespace = 'community'::regnamespace`,
    ).toHaveLength(0);
  });

  it("chức vụ người đăng bài công ty mình: chỉ trong tenant người xem; người dùng ngoài nhận rỗng", async () => {
    const q = (t: string) =>
      inPackAs(
        "community",
        t,
        VY,
        (tx) =>
          tx<
            { job_title: string }[]
          >`select job_title from community.author_titles(${tx.array([POSTER])}::uuid[])`,
      );
    expect((await q(A)).map((r) => r.job_title)).toEqual(["Trưởng phòng mua hàng"]);
    expect((await q(B)).length).toBe(0);
    const ext = await inPackAs("community", A, VY, async (tx) => {
      await tx`select set_config('app.user_kind', 'external', true)`;
      return tx`select * from community.author_titles(${tx.array([POSTER])}::uuid[])`;
    });
    expect(ext.length).toBe(0);
  });

  it("API bảng tin (service): một dòng gộp bài công ty mình + đối tác, mới nhất trước, nhãn nguồn + công ty + chức vụ", async () => {
    const uow = createPackUow(db, "community", (tx) => ({ tx }));
    const a = {
      who: { tenantId: B, userId: VY, userKind: "internal" },
      org: null,
      canWrite: true,
      joinAdmin: false,
      dir: { tenantName: "B", userName: "Vy", orgs: [] },
    } as unknown as Access;
    const f = {
      org: null,
      tab: "all" as const,
      cat: null,
      area: null,
      author: null,
      authorUser: null,
      q: null,
      mine: false,
      cursor: null,
      limit: 20,
    };
    const out = await feed(uow as never, a, f);
    const m = mergeNewest(out.own.items, out.connected, 20);
    expect(m.items.map((x) => `${x.src}:${x.row.title}`)).toEqual([
      "own:RAW-b_own", // người nội bộ xem bài công ty mình: bản gốc
      "connected:all_new",
      "connected:companies_B",
      "connected:all_old",
    ]);
    const v = connectedView(out.connected[0] as (typeof out.connected)[number]);
    expect([v.source, v.authorOrgName, v.authorTitle, v.fileCount, v.actions]).toEqual([
      "connected",
      "Công ty A Đăng",
      "Trưởng phòng mua hàng",
      2,
      [],
    ]);
    const arch = await feed(uow as never, a, { ...f, tab: "archived" });
    expect(arch.connected).toEqual([]); // lưu trữ chỉ bài công ty mình
  });
});
