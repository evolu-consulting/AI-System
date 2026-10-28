// CR-102 · com-c3 · hien-thi.md HT-01…HT-50, HT-70…HT-73: ma trận người xem × nội dung bằng RLS thật (role `community_rw`,
// `app.user_id` như `withPackScope`). Một dòng = một ca; "không thấy" = 0 hàng. Ghi sai phía (đăng thay công ty khác, bình luận
// luồng khác, sửa bài chủ quản, ghi nhãn đối tác) bị chặn ở DB.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cloneDb, inPackAs, openOwner, pgCode, type Sql } from "@ai/test-kit/db";
import {
  type Cast,
  seedCast,
  seedComments,
  seedPosts,
} from "../../../../../../../tests/acceptance/com-c3/_support/cast";

let sql: Sql;
let c: Cast;
let P = new Map<string, string>();
let C = new Map<string, string>();

const as = <R>(u: string, fn: (tx: Sql) => Promise<R>) => inPackAs("community", c.A, u, fn);
const keysOf = (rows: { k: string }[]) => rows.map((r) => r.k).sort();
const postsSeen = (u: string) =>
  as(u, async (tx) => keysOf(await tx`select title_raw as k from community.posts`));
const commentsSeen = (u: string) =>
  as(u, async (tx) => keysOf(await tx`select text_raw as k from community.comments`));
const threadsSeen = (u: string) =>
  as(u, async (tx) =>
    keysOf(
      await tx`select p.title_raw || '/' || t.ext_org_id::text as k from community.threads t
      join community.posts p on p.id = t.post_id`,
    ),
  );

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  c = await seedCast(sql, 31);
  const host = (
    key: string,
    aud: { mode: string; cats?: string[]; orgs?: string[] },
    more = {},
  ) => ({
    key,
    type: "sell" as const,
    org: null,
    author: c.hA,
    aud,
    cats: ["dong-goi"],
    ...more,
  });
  P = await seedPosts(sql, c.A, [
    host("P_all", { mode: "all" }),
    host("P_buyers", { mode: "buyers" }),
    host("P_suppliers", { mode: "suppliers" }),
    host("P_cats", { mode: "cats" }),
    host("P_buy_cats", { mode: "cats" }, { type: "buy" }),
    host("P_co_S2", { mode: "companies", orgs: [] }),
    host("P_archived", { mode: "all" }, { status: "archived" }),
    host("P_hidden", { mode: "all" }, { hidden: true }),
    host("P_expired", { mode: "all" }, { expired: true }),
    host("P_edited", { mode: "all" }, { edited: true }),
    { key: "S1_sell", type: "sell", org: c.S1, author: c.s1a },
    { key: "S1_hidden", type: "sell", org: c.S1, author: c.s1a, hidden: true },
    { key: "S1_archived", type: "sell", org: c.S1, author: c.s1b, status: "archived" },
    { key: "B1_buy", type: "buy", org: c.B1, author: c.b1 },
    { key: "X_sell", type: "sell", org: c.X, author: c.x1 },
    { key: "X_buy", type: "buy", org: c.X, author: c.x1 },
    { key: "LEFT_sell", type: "sell", org: c.LEFT, author: c.gone },
  ]);
  await sql`update community.posts set aud_orgs = ${sql.array([c.S2])}::uuid[] where id = ${P.get("P_co_S2") as string}`;
  const pa = P.get("P_all") as string;
  C = await seedComments(sql, c.A, [
    { key: "c_s1b", post: pa, thread: c.S1, author: c.s1b, org: c.S1 },
    { key: "c_host_to_S1", post: pa, thread: c.S1, author: c.hA, org: null },
    { key: "c_s1_hidden", post: pa, thread: c.S1, author: c.s1a, org: c.S1, hidden: true },
    { key: "c_s2", post: pa, thread: c.S2, author: c.s2, org: c.S2 },
    { key: "c_host_to_S2", post: pa, thread: c.S2, author: c.hM, org: null },
    {
      key: "c_arch_s1",
      post: P.get("P_archived") as string,
      thread: c.S1,
      author: c.s1a,
      org: c.S1,
    },
    {
      key: "c_s1post_s1",
      post: P.get("S1_sell") as string,
      thread: c.S1,
      author: c.s1a,
      org: c.S1,
    },
    {
      key: "c_s1post_host",
      post: P.get("S1_sell") as string,
      thread: c.S1,
      author: c.hA,
      org: null,
    },
  ]);
}, 120_000);
afterAll(async () => {
  await sql?.end({ timeout: 2 });
});

const ALL_POSTS = () => [...P.keys()].sort();

describe("§1–2 bài (HT-01…HT-32)", () => {
  // [ca, người xem, bài, thấy?]
  const rows: [string, keyof Cast, string, boolean][] = [
    ["HT-02", "s1a", "P_all", true],
    ["HT-03", "b1", "P_all", true],
    ["HT-04", "s1a", "P_buyers", false],
    ["HT-05", "b1", "P_suppliers", false],
    ["HT-06", "b1", "P_cats", true],
    ["HT-07", "b2", "P_cats", false],
    ["HT-08", "s1a", "P_co_S2", false],
    ["HT-09", "s2", "P_co_S2", true],
    ["HT-10", "x1", "P_suppliers", true],
    ["HT-11", "x1", "P_buyers", true],
    ["HT-12 vô hiệu", "off", "P_all", false],
    ["HT-12 công ty rời", "gone", "P_all", false],
    ["HT-13", "s1a", "P_cats", false],
    ["HT-14", "b1", "P_buy_cats", false],
    ["HT-14 đối chứng NCC cùng nhóm", "s1a", "P_buy_cats", true],
    ["HT-15", "s1a", "P_archived", false],
    ["HT-16", "s1a", "P_hidden", false],
    ["HT-18", "s1a", "P_expired", false],
    ["HT-19", "s1a", "P_edited", true],
    ["HT-21 S1a", "s1a", "S1_sell", true],
    ["HT-21 S1b", "s1b", "S1_sell", true],
    ["HT-22", "s2", "S1_sell", false],
    ["HT-23", "b1", "S1_sell", false],
    ["HT-24", "b1", "B1_buy", true],
    ["HT-25", "b2", "B1_buy", false],
    ["HT-26", "s1a", "B1_buy", false],
    ["HT-27", "x1", "S1_sell", false],
    ["HT-28 bán", "x1", "X_sell", true],
    ["HT-28 mua", "x1", "X_buy", true],
    ["HT-30 (Chưa rõ #1: thấy)", "s1a", "S1_hidden", true],
    ["HT-30 người khác", "s2", "S1_hidden", false],
    ["HT-31", "s1b", "S1_archived", true],
    ["HT-32 người rời", "gone", "LEFT_sell", false],
  ];
  const seen = new Map<string, Promise<string[]>>();
  const of = (u: keyof Cast) => {
    const id = c[u] as string;
    if (!seen.has(id)) seen.set(id, postsSeen(id));
    return seen.get(id) as Promise<string[]>;
  };
  it.each(rows)("%s · %s xem %s ⇒ %p", async (_ht, who, key, want) => {
    expect((await of(who)).includes(key)).toBe(want);
  });
  it("HT-01 / HT-20 / HT-29 / HT-32: A và M thấy mọi bài (lưu trữ, ẩn, hết hạn, của đối tác, đối tác đã rời)", async () => {
    expect({ A: await of("hA"), M: await of("hM") }).toEqual({ A: ALL_POSTS(), M: ALL_POSTS() });
  });
  it("HT-17: bài đã xoá biến mất với mọi người; bình luận đi theo (cascade)", async () => {
    const [id] = (
      await seedPosts(sql, c.A, [{ key: "P_del", type: "note", org: null, author: c.hA }])
    ).values();
    await seedComments(sql, c.A, [
      { key: "c_del", post: id as string, thread: c.S1, author: c.s1a, org: c.S1 },
    ]);
    const before = (await postsSeen(c.s1a)).includes("P_del");
    const n = await as(
      c.hA,
      async (tx) => (await tx`delete from community.posts where id = ${id as string}`).count,
    );
    expect({
      before,
      n,
      s1: (await postsSeen(c.s1a)).includes("P_del"),
      host: await commentsSeen(c.hA),
    }).toEqual({
      before: true,
      n: 1,
      s1: false,
      host: expect.not.arrayContaining(["c_del"]),
    });
  });
});

describe("§3 bình luận theo luồng (HT-40…HT-50)", () => {
  it("HT-40: chủ quản thấy mọi luồng và mọi bình luận (kể cả bị ẩn)", async () => {
    expect(await commentsSeen(c.hM)).toEqual([...C.keys()].sort());
  });
  it("HT-41/42/43/44/46/47/48: S1a chỉ thấy luồng của S1 trên bài mình thấy, không bình luận ẩn", async () => {
    expect(await commentsSeen(c.s1a)).toEqual([
      "c_host_to_S1",
      "c_s1b",
      "c_s1post_host",
      "c_s1post_s1",
    ]);
    expect(await threadsSeen(c.s1a)).toEqual([`P_all/${c.S1}`, `S1_sell/${c.S1}`]);
  });
  it("HT-42/44/48: S2 chỉ thấy luồng của S2; không thấy luồng S1 trên bài của S1", async () => {
    expect(await commentsSeen(c.s2)).toEqual(["c_host_to_S2", "c_s2"]);
  });
  it("HT-45: B1 không thấy bình luận của S1 trên cùng bài", async () => {
    expect({ c: await commentsSeen(c.b1), t: await threadsSeen(c.b1) }).toEqual({ c: [], t: [] });
  });
  it("HT-49: A ghi bình luận vào luồng S1 ⇒ S1b thấy, S2 không", async () => {
    const pa = P.get("P_all") as string;
    await as(
      c.hA,
      (
        tx,
      ) => tx`insert into community.comments (tenant_id, post_id, thread_id, thread_org, author_user_id,
        author_org, text_raw, text_masked)
      select ${c.A}::uuid, ${pa}::uuid, t.id, t.ext_org_id, ${c.hA}::uuid, null, 'c_ht49', 'c_ht49'
      from community.threads t where t.post_id = ${pa}::uuid and t.ext_org_id = ${c.S1}::uuid`,
    );
    expect({
      s1b: (await commentsSeen(c.s1b)).includes("c_ht49"),
      s2: (await commentsSeen(c.s2)).includes("c_ht49"),
    }).toEqual({ s1b: true, s2: false });
  });
  it("HT-50: S1a xoá bình luận của chính mình ⇒ mất ở cả hai phía; không xoá được của S1b", async () => {
    const id = C.get("c_s1post_s1") as string;
    const other = C.get("c_s1b") as string;
    const del = (x: string) =>
      as(
        c.s1a,
        async (tx) => (await tx`delete from community.comments where id = ${x}::uuid`).count,
      );
    expect({ own: await del(id), other: await del(other) }).toEqual({ own: 1, other: 0 });
    expect({
      host: (await commentsSeen(c.hA)).includes("c_s1post_s1"),
      s1b: (await commentsSeen(c.s1b)).includes("c_s1b"),
    }).toEqual({ host: false, s1b: true });
  });
});

describe("§6 bạn bè / hồ sơ (HT-70…HT-73)", () => {
  const orgs = (u: string) =>
    as(u, async (tx) =>
      (await tx`select ext_org_id::text as k from community.partner_companies`).map((r) => r.k),
    );
  it("HT-70/72: A, M thấy mọi công ty đối tác; HT-71/73: S1, B1 chỉ thấy hàng của công ty mình", async () => {
    expect({
      A: (await orgs(c.hA)).length,
      M: (await orgs(c.hM)).length,
      S1: await orgs(c.s1a),
      B1: await orgs(c.b1),
      gone: await orgs(c.gone),
    }).toEqual({ A: 6, M: 6, S1: [c.S1], B1: [c.B1], gone: [] });
  });
});

describe("ghi sai phía bị DB chặn", () => {
  const ins = (u: string, org: string | null, type = "sell") =>
    pgCode(() =>
      as(
        u,
        (
          tx,
        ) => tx`insert into community.posts (tenant_id, type, author_user_id, author_org, aud_mode)
        values (${c.A}::uuid, ${type}, ${u}::uuid, ${org}::uuid, ${org === null ? "all" : null})`,
      ),
    );
  it("đối tác đăng dưới tên công ty khác / chủ quản; chủ quản đăng thay đối tác ⇒ 42501; đối tác đăng Thông báo ⇒ 23514", async () => {
    expect({
      s1AsS2: await ins(c.s1a, c.S2),
      s1AsHost: await ins(c.s1a, null),
      hostAsS1: await ins(c.hA, c.S1),
      s1Note: await ins(c.s1a, c.S1, "note"),
      s1Ok: await ins(c.s1a, c.S1),
    }).toEqual({
      s1AsS2: "42501",
      s1AsHost: "42501",
      hostAsS1: "42501",
      s1Note: "23514",
      s1Ok: null,
    });
  });
  it("đối tác không sửa/xoá bài chủ quản (0 hàng), không ghi nhãn đối tác, không bình luận luồng công ty khác", async () => {
    const pa = P.get("P_all") as string;
    const upd = await as(
      c.s1a,
      async (tx) =>
        (await tx`update community.posts set hidden = true where id = ${pa}::uuid`).count,
    );
    const del = await as(
      c.s1a,
      async (tx) => (await tx`delete from community.posts where id = ${pa}::uuid`).count,
    );
    const label = await pgCode(() =>
      as(
        c.s1a,
        (tx) =>
          tx`update community.partner_companies set labels = '{supplier,buyer}' where ext_org_id = ${c.S1}::uuid`,
      ),
    );
    const cross = await pgCode(() =>
      as(
        c.s1a,
        (
          tx,
        ) => tx`insert into community.comments (tenant_id, post_id, thread_id, thread_org, author_user_id,
          author_org, text_raw, text_masked)
        select ${c.A}::uuid, ${pa}::uuid, t.id, ${c.S2}::uuid, ${c.s1a}::uuid, ${c.S1}::uuid, 'x', 'x'
        from community.threads t where t.post_id = ${pa}::uuid and t.ext_org_id = ${c.S2}::uuid`,
      ),
    );
    const s2Thread = await pgCode(() =>
      as(
        c.s1a,
        (tx) => tx`insert into community.threads (tenant_id, post_id, ext_org_id)
        values (${c.A}::uuid, ${pa}::uuid, ${c.S2}::uuid)`,
      ),
    );
    const hiddenPost = await pgCode(() =>
      as(
        c.b1,
        (tx) => tx`insert into community.threads (tenant_id, post_id, ext_org_id)
        values (${c.A}::uuid, ${P.get("P_suppliers") as string}::uuid, ${c.B1}::uuid)`,
      ),
    );
    expect({ upd, del, label, cross, s2Thread, hiddenPost }).toEqual({
      upd: 0,
      del: 0,
      label: "42501",
      cross: null, // luồng S2 không thấy dưới S1 ⇒ SELECT nguồn 0 hàng ⇒ không chèn gì
      s2Thread: "42501",
      hiddenPost: "42501",
    });
    expect((await commentsSeen(c.hA)).filter((k) => k === "x")).toEqual([]);
  });
});
