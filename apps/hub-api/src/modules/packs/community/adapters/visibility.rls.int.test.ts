// CR-102 · com-c3 · CR-129 · hien-thi.md HT-01…HT-52, HT-70…HT-73: ma trận người xem × nội dung bằng RLS thật (role `community_rw`,
// `app.user_id` như `withPackScope`). Một dòng = một ca; "không thấy" = 0 hàng. Bình luận phẳng theo bạn bè (CR-129): đối tác thấy
// bình luận của chủ quản + công ty mình + bài của mình + bình luận nhắc mình. Ghi sai phía (đăng thay công ty khác, bình luận
// thay công ty khác, nhắc người không phải bạn, sửa bài chủ quản, ghi nhãn đối tác) bị chặn ở DB.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cloneDb, inPackAs, openOwner, pgCode, type Sql } from "@ai/test-kit/db";
import {
  type Cast,
  seedCast,
  seedPosts,
} from "../../../../../../../tests/acceptance/com-c3/_support/cast";
import { seedComments } from "./comment-seed.testkit";

let sql: Sql;
let c: Cast;
const ALL_ORGS: string[] = []; // công ty đối tác truyền cho hàm cổng `contracts.community_partners` (host = tất cả, đối tác = chỉ mình)
let P = new Map<string, string>();
let C = new Map<string, string>();

const as = <R>(u: string, fn: (tx: Sql) => Promise<R>) => inPackAs("community", c.A, u, fn);
const keysOf = (rows: { k: string }[]) => rows.map((r) => r.k).sort();
const postsSeen = (u: string) =>
  as(u, async (tx) => keysOf(await tx`select title_raw as k from community.posts`));
const commentsSeen = (u: string) =>
  as(u, async (tx) => keysOf(await tx`select text_raw as k from community.comments`));

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  c = await seedCast(sql, 31);
  ALL_ORGS.push(c.S1, c.S2, c.B1, c.B2, c.X, c.LEFT);
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
    { key: "c_s1b", post: pa, author: c.s1b, org: c.S1 },
    { key: "c_host_to_S1", post: pa, author: c.hA, org: null, mentions: [c.S1] },
    { key: "c_s1_hidden", post: pa, author: c.s1a, org: c.S1, hidden: true },
    { key: "c_s2", post: pa, author: c.s2, org: c.S2 },
    { key: "c_host_to_S2", post: pa, author: c.hM, org: null, mentions: [c.S2] },
    // HT-51: S2 nhắc S1 (chèn bằng owner — RLS không cho đối tác nhắc ai); HT-5x: S2 trên bài của S1 (cùng cách)
    { key: "c_s2_tag_S1", post: pa, author: c.s2, org: c.S2, mentions: [c.S1] },
    { key: "c_arch_s1", post: P.get("P_archived") as string, author: c.s1a, org: c.S1 },
    { key: "c_s1post_s1", post: P.get("S1_sell") as string, author: c.s1a, org: c.S1 },
    { key: "c_s1post_host", post: P.get("S1_sell") as string, author: c.hA, org: null },
    { key: "c_s2_on_s1post", post: P.get("S1_sell") as string, author: c.s2, org: c.S2 },
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
    await seedComments(sql, c.A, [{ key: "c_del", post: id as string, author: c.s1a, org: c.S1 }]);
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

describe("§3 bình luận mở theo bạn bè (HT-40…HT-52)", () => {
  it("HT-40: chủ quản thấy mọi bình luận (kể cả bị ẩn, của mọi đối tác)", async () => {
    expect(await commentsSeen(c.hM)).toEqual([...C.keys()].sort());
  });
  it("HT-41/43/44/46/47: S1a thấy bình luận của công ty mình + chủ quản (kể cả trả lời S2) + được nhắc + trên bài của mình; không thấy S2, không bị ẩn", async () => {
    expect(await commentsSeen(c.s1a)).toEqual([
      "c_host_to_S1",
      "c_host_to_S2", // HT-44: câu chủ quản trả lời S2 nay S1 cũng thấy
      "c_s1b",
      "c_s1post_host",
      "c_s1post_s1",
      "c_s2_on_s1post", // bài của chính S1: thấy mọi bình luận trên bài
      "c_s2_tag_S1", // HT-51: được nhắc
    ]);
  });
  it("HT-42/48: S2 thấy bình luận của S2 + chủ quản; không thấy bình luận của S1, không thấy bài của S1", async () => {
    expect(await commentsSeen(c.s2)).toEqual([
      "c_host_to_S1",
      "c_host_to_S2",
      "c_s2",
      "c_s2_tag_S1",
    ]);
  });
  it("HT-45: B1 chỉ thấy bình luận của chủ quản trên bài mình thấy; không thấy bình luận của S1/S2", async () => {
    expect(await commentsSeen(c.b1)).toEqual(["c_host_to_S1", "c_host_to_S2"]);
  });
  it("HT-49: A ghi bình luận ⇒ mọi đối tác thấy bài đều thấy (S1b, S2, B1)", async () => {
    const pa = P.get("P_all") as string;
    await as(
      c.hA,
      (
        tx,
      ) => tx`insert into community.comments (tenant_id, post_id, author_user_id, author_org, text_raw, text_masked)
      values (${c.A}::uuid, ${pa}::uuid, ${c.hA}::uuid, null, 'c_ht49', 'c_ht49')`,
    );
    expect({
      s1b: (await commentsSeen(c.s1b)).includes("c_ht49"),
      s2: (await commentsSeen(c.s2)).includes("c_ht49"),
      b1: (await commentsSeen(c.b1)).includes("c_ht49"),
    }).toEqual({ s1b: true, s2: true, b1: true });
  });
  it("HT-51: chủ quản nhắc S1 trong bình luận ⇒ ghi được (mention_orgs = [S1]); HT-52: S1 không nhắc được S2 / chính mình ⇒ 42501", async () => {
    const pa = P.get("P_all") as string;
    const ins = (u: string, org: string | null, mentions: string[]) =>
      pgCode(() =>
        as(
          u,
          (
            tx,
          ) => tx`insert into community.comments (tenant_id, post_id, author_user_id, author_org, text_raw, text_masked,
            mention_orgs) values (${c.A}::uuid, ${pa}::uuid, ${u}::uuid, ${org}::uuid, 'x51', 'x51', ${tx.array(mentions)}::uuid[])`,
        ),
      );
    expect({
      hostTagsS1S2: await ins(c.hA, null, [c.S1, c.S2]),
      s1TagsS2: await ins(c.s1a, c.S1, [c.S2]),
      s1TagsSelf: await ins(c.s1a, c.S1, [c.S1]),
      s1NoTag: await ins(c.s1a, c.S1, []),
    }).toEqual({ hostTagsS1S2: null, s1TagsS2: "42501", s1TagsSelf: "42501", s1NoTag: null });
    const tooMany = await pgCode(
      () =>
        sql`insert into community.comments (tenant_id, post_id, author_user_id, author_org, text_raw, text_masked, mention_orgs)
        values (${c.A}::uuid, ${pa}::uuid, ${c.hA}::uuid, null, 'x', 'x', ${sql.array(Array.from({ length: 11 }, () => c.S1))}::uuid[])`,
    );
    expect(tooMany).toBe("23514");
  });
  it("lời nhắc bất biến khi sửa ⇒ 23514 (sửa chữ không phát chuông lại)", async () => {
    const id = C.get("c_s2_tag_S1") as string;
    const code = await pgCode(() =>
      as(
        c.s2,
        (tx) => tx`update community.comments set mention_orgs = '{}' where id = ${id}::uuid`,
      ),
    );
    expect(code).toBe("23514");
  });
  it("soát RLS: chủ quản chỉ nhắc được công ty ĐỐI TÁC của tenant mình, đang hoạt động, thấy được bài ⇒ còn lại 42501 ở DB", async () => {
    const pa = P.get("P_all") as string;
    const psup = P.get("P_suppliers") as string; // chỉ nhà cung cấp: B1 (người mua) không thấy
    const orgB = crypto.randomUUID();
    await sql`insert into admin.external_orgs (id, tenant_id, name, active) values (${orgB}::uuid, ${c.B}::uuid, 'Công ty tenant B', true)`;
    const ins = (post: string, mentions: string[]) =>
      pgCode(() =>
        as(
          c.hA,
          (
            tx,
          ) => tx`insert into community.comments (tenant_id, post_id, author_user_id, author_org, text_raw, text_masked,
            mention_orgs) values (${c.A}::uuid, ${post}::uuid, ${c.hA}::uuid, null, 'x_mt', 'x_mt', ${tx.array(mentions)}::uuid[])`,
        ),
      );
    expect({
      otherTenantOrg: await ins(pa, [orgB]),
      randomOrg: await ins(pa, [crypto.randomUUID()]),
      inactiveOrg: await ins(pa, [c.LEFT]),
      orgCannotSeePost: await ins(psup, [c.B1]),
      okSeesPost: await ins(psup, [c.S1]),
    }).toEqual({
      otherTenantOrg: "42501",
      randomOrg: "42501",
      inactiveOrg: "42501",
      orgCannotSeePost: "42501",
      okSeesPost: null,
    });
  });
  it("soát RLS: được nhắc trên bài mình KHÔNG thấy ⇒ không thấy bình luận (bài chặn trước); đọc chéo tenant ⇒ 0 hàng", async () => {
    const psup = P.get("P_suppliers") as string;
    await seedComments(sql, c.A, [
      { key: "c_tag_unseen", post: psup, author: c.hA, org: null, mentions: [c.B1] }, // owner bỏ RLS ghi
    ]);
    expect({
      b1: (await commentsSeen(c.b1)).includes("c_tag_unseen"),
      s1: (await commentsSeen(c.s1a)).includes("c_tag_unseen"), // S1 thấy bài + bình luận chủ quản
      host: (await commentsSeen(c.hA)).includes("c_tag_unseen"),
    }).toEqual({ b1: false, s1: true, host: true });
    // chủ quản tenant B (cùng DB) đọc bảng bình luận: không thấy hàng nào của tenant A
    const crossRead = await inPackAs("community", c.B, c.hB, async (tx) =>
      keysOf(await tx`select text_raw as k from community.comments`),
    );
    expect(crossRead).toEqual([]);
  });
  it("HT-50: S1a xoá bình luận của chính mình ⇒ mất ở mọi phía; không xoá được của S1b", async () => {
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
      (
        await tx`select ext_org_id::text as k from contracts.community_partners(
          array(select jsonb_array_elements_text(${tx.json(ALL_ORGS)}::jsonb)::uuid))`
      ).map((r) => r.k),
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
  it("đối tác không sửa/xoá bài chủ quản (0 hàng), không ghi nhãn đối tác, không bình luận dưới tên công ty khác / trên bài không thấy", async () => {
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
          tx`update contracts.partner_profiles set cats = '{x}' where ext_org_id = ${c.S1}::uuid`,
      ),
    );
    const cmt = (u: string, org: string, post: string) =>
      pgCode(() =>
        as(
          u,
          (
            tx,
          ) => tx`insert into community.comments (tenant_id, post_id, author_user_id, author_org, text_raw, text_masked)
          values (${c.A}::uuid, ${post}::uuid, ${u}::uuid, ${org}::uuid, 'x', 'x')`,
        ),
      );
    const cross = await cmt(c.s1a, c.S2, pa); // bình luận dưới tên công ty khác
    const hiddenPost = await cmt(c.b1, c.B1, P.get("P_suppliers") as string); // bài B1 không thấy
    expect({ upd, del, label, cross, hiddenPost }).toEqual({
      upd: 0,
      del: 0,
      label: "42501",
      cross: "42501",
      hiddenPost: "42501",
    });
    expect((await commentsSeen(c.hA)).filter((k) => k === "x")).toEqual([]);
  });
});
