// CR-191 · lát cr191-cross-comment · BR-191-12: người công ty ĐÃ KẾT NỐI bình luận bài đối tác họ thấy (community 0032, DEFINER).
// Route + RLS + DEFINER + chuông thật. N2: bài do hM (nhân viên, không phải quản trị) đăng; hA (quản trị, KHÔNG phải người đăng) ẩn/xoá
// bình luận của người công ty B; hB viết, uB2 (đồng nghiệp hB) không sửa/xoá được bình luận của hB.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db, type Tx } from "@ai/db";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import { type Cast, seedCast } from "../../../../../../../tests/acceptance/com-c3/_support/cast";
import { mapError } from "../../../../lib/errors";
import { pgExternalOrgResolver } from "../../kit/adapters/ext-org.pg";
import type { PackAccessView, PackGuardVars } from "../../kit/adapters/pack-guard.middleware";
import { createPackUow } from "../../kit/adapters/pack-uow";
import { communityModule } from "../community.mount";
import * as list from "./comment-list.service";
import type { Access } from "./community-access";

let own: Sql;
let db: Db;
let c: Cast;
let app: Hono<PackGuardVars>;
let C: string; // công ty KHÔNG kết nối
let D: string; // công ty kết nối khác (dùng cho «Chọn công ty» không có B)
let uC: string;
let uB2: string;
let uA3: string; // người nội bộ A KHÔNG có quyền gói (không thấy bài)
const F = { read: "xc-r", write: "xc-w", admin: "xc-a", addon: "xc-ad" };
type Who = "hA" | "hM" | "hB" | "uB2" | "uC" | "s1a";

const tenantOf = (w: Who): string => (w === "hB" || w === "uB2" ? c.B : w === "uC" ? C : c.A);
const idOf = (w: Who): string => (w === "uB2" ? uB2 : w === "uC" ? uC : c[w]);

const view = (): PackAccessView => ({
  catalog: async () => ({
    features: [
      { id: F.read, key: "contracts-read", status: "on" },
      { id: F.write, key: "contracts-write", status: "on" },
      { id: F.admin, key: "contracts-admin", status: "on" },
      { id: F.addon, key: "contracts-community", status: "on" },
    ],
    entitled: new Set([c.A, c.B, C].flatMap((t) => Object.values(F).map((f) => `${t}:${f}`))),
    grantGroups: new Map([
      [`${c.A}:${F.read}`, [c.roles.owner, c.roles.editor]],
      [`${c.A}:${F.write}`, [c.roles.owner, c.roles.editor]],
      [`${c.A}:${F.admin}`, [c.roles.owner]],
      [`${c.B}:${F.read}`, [c.rolesB.owner, c.rolesB.editor]],
      [`${c.B}:${F.write}`, [c.rolesB.owner, c.rolesB.editor]],
      [`${C}:${F.read}`, ["g-c"]],
      [`${C}:${F.write}`, ["g-c"]],
    ]),
  }),
  user: async (id) => {
    const g: Record<string, string> = {
      [c.hA]: c.roles.owner,
      [c.hM]: c.roles.editor,
      [c.hB]: c.rolesB.owner,
      [uB2]: c.rolesB.editor,
      [uC]: "g-c",
    };
    const t = id === c.hB || id === uB2 ? c.B : id === uC ? C : c.A;
    return { tenantId: t, groupIds: new Set(g[id] ? [g[id] as string] : []) };
  },
});

const call = async (who: Who, method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { "x-who": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};
const bells = async (u: string, kind?: string): Promise<number> => {
  const r = (await own`select count(*)::int as n from hub.notifications where user_id = ${u}::uuid
    and source = 'community' and (${kind ?? null}::text is null or kind = ${kind ?? ""})`) as unknown as {
    n: number;
  }[];
  return r[0]?.n ?? 0;
};
const post = async (title: string, audience: unknown, who: Who = "hM"): Promise<string> => {
  const r = await call(who, "POST", "/posts", { type: "note", title, body: "Nội dung", audience });
  expect(r.status).toBe(201);
  return r.json.id as string;
};
const aud = (mode: string, tenantsIn: string[] = []) => ({
  mode,
  cats: [],
  companies: [],
  tenants: tenantsIn,
});
const texts = (r: { json: { comments: { text: string }[] } }) => r.json.comments.map((x) => x.text);
const setLink = (on: boolean) =>
  own`update hub.partner_links set accepted_at = ${on ? new Date() : null} where from_tenant = ${c.A} and to_tenant = ${c.B}`;

let pAll: string;

beforeAll(async () => {
  await cloneDb("full");
  own = openOwner(2);
  c = await seedCast(own, 58);
  [C, D] = (await tenants(own, 2, 5890)) as [string, string];
  [uC] = (await users(own, C, 1, { from: 5891 })) as [string];
  [uB2] = (await users(own, c.B, 1, { from: 5892 })) as [string];
  [uA3] = (await users(own, c.A, 1, { from: 5893 })) as [string];
  await own`insert into hub.partner_links (from_tenant, to_tenant, accepted_at)
    values (${c.A}, ${c.B}, now()), (${c.B}, ${c.A}, now()), (${c.A}, ${D}, now()), (${D}, ${c.A}, now())`;
  await own`insert into admin.feature_entitlements (feature_id, tenant_id)
    select f.id, t from admin.features f, unnest(${own.array([c.A, c.B, C, D])}::uuid[]) t where f.key = 'contracts-community'
    on conflict (feature_id, tenant_id) do update set revoked_at = null`;
  db = createDb(urls().hubApi, { max: 2 });
  const h = new Hono<PackGuardVars>();
  h.use("*", async (ctx, next) => {
    const who = ctx.req.header("x-who") as Who;
    ctx.set("user", {
      userId: idOf(who),
      tenantId: tenantOf(who),
      role: who === "hA" || who === "hB" ? "tenant_admin" : "member",
      ...(who === "s1a" ? { userKind: "external", extOrgId: c.S1 } : { userKind: "internal" }),
    } as never);
    await next();
  });
  h.route("/", communityModule(db, view(), pgExternalOrgResolver(db)));
  h.onError((e, ctx) => {
    const m = mapError(e);
    return ctx.json(m.body, m.status);
  });
  app = h;
  pAll = await post("Bài cho mọi đối tác", aud("all"));
}, 120_000);
afterAll(async () => {
  await db?.close();
  await own?.end({ timeout: 2 });
});

describe("CR-191 · bình luận chéo công ty đã kết nối", () => {
  it("B bình luận bài A «Tất cả đối tác»: ghi, đọc danh sách, bảng tin có số + bình luận mới nhất — A thấy kèm tên công ty B", async () => {
    const w = await call("hB", "POST", `/posts/${pAll}/comments`, {
      text: "Bên B quan tâm",
      mentions: [],
    });
    expect(w.status).toBe(201);
    expect(w.json.mine).toBe(true);
    const row =
      (await own`select tenant_id::text t, author_tenant::text at from community.comments where id = ${w.json.id}::uuid`) as unknown as {
        t: string;
        at: string;
      }[];
    expect(row[0]).toEqual({ t: c.A, at: c.B });
    await call("hM", "POST", `/posts/${pAll}/comments`, { text: "A trả lời", mentions: [] });
    const r = await call("hB", "GET", `/posts/${pAll}/comments`);
    expect(r.status).toBe(200);
    expect(texts(r)).toEqual(["Bên B quan tâm", "A trả lời"]);
    expect(r.json.comments[1].fromConnected).toBe(true);
    const feed = await call("hB", "GET", "/feed");
    const p = feed.json.items.find((x: { id: string }) => x.id === pAll);
    expect(p.commentCount).toBe(2);
    expect(p.recentComments.map((x: { text: string }) => x.text)).toEqual([
      "Bên B quan tâm",
      "A trả lời",
    ]);
    const a = await call("hM", "GET", `/posts/${pAll}/comments`);
    const fromB = a.json.comments.find((x: { id: string }) => x.id === w.json.id);
    expect(fromB).toMatchObject({
      fromConnected: true,
      authorSide: "partner",
      authorOrgId: c.B,
      mine: false,
    });
    const nb =
      (await own`select coalesce(nullif(btrim(legal_name), ''), name) as n from admin.tenants where id = ${c.B}`) as unknown as {
        n: string;
      }[];
    expect(fromB.authorOrgName).toBe(nb[0]?.n as string); // e2e CR191-C2: tên công ty người viết chéo
  });

  it("bài A «Chỉ nội bộ» / «Chọn công ty» không có B ⇒ B không đọc, không ghi (404)", async () => {
    for (const id of [
      await post("Nội bộ", aud("internal")),
      await post("Chỉ D", aud("companies", [D])),
    ]) {
      expect((await call("hB", "GET", `/posts/${id}/comments`)).status).toBe(404);
      expect(
        (await call("hB", "POST", `/posts/${id}/comments`, { text: "x", mentions: [] })).status,
      ).toBe(404);
    }
  });

  it("công ty C không kết nối ⇒ không đọc, không ghi", async () => {
    expect((await call("uC", "GET", `/posts/${pAll}/comments`)).status).toBe(404);
    expect(
      (await call("uC", "POST", `/posts/${pAll}/comments`, { text: "C", mentions: [] })).status,
    ).toBe(404);
  });

  it("B sửa/xoá bình luận của B — đồng nghiệp B và người A không sửa/xoá được bình luận của B", async () => {
    const w = await call("hB", "POST", `/posts/${pAll}/comments`, { text: "Sẽ sửa", mentions: [] });
    const path = `/posts/${pAll}/comments/${w.json.id}`;
    expect((await call("uB2", "PATCH", path, { text: "Đồng nghiệp sửa" })).status).toBe(404);
    expect((await call("uB2", "DELETE", path)).status).toBe(404);
    expect((await call("hM", "PATCH", path, { text: "A sửa" })).status).toBe(404);
    const e = await call("hB", "PATCH", path, { text: "Đã sửa" });
    expect(e.status).toBe(200);
    expect(e.json.text).toBe("Đã sửa");
    // B không sửa/xoá/ẩn bình luận của A
    const a = await call("hM", "POST", `/posts/${pAll}/comments`, { text: "Của A", mentions: [] });
    expect(
      (await call("hB", "PATCH", `/posts/${pAll}/comments/${a.json.id}`, { text: "B sửa" })).status,
    ).toBe(404);
    expect((await call("hB", "DELETE", `/posts/${pAll}/comments/${a.json.id}`)).status).toBe(404);
    expect(
      (await call("hB", "POST", `/posts/${pAll}/comments/${a.json.id}/hide`, { hidden: true }))
        .status,
    ).toBe(404);
    expect((await call("hB", "DELETE", path)).status).toBe(204);
  });

  it("N2 · người đăng bài (hM) ẩn, quản trị A (hA, không phải người đăng) ẩn/xoá bình luận của B — bị ẩn ⇒ B không thấy", async () => {
    const w = await call("hB", "POST", `/posts/${pAll}/comments`, {
      text: "Sẽ bị ẩn",
      mentions: [],
    });
    const path = `/posts/${pAll}/comments/${w.json.id}`;
    const list = await call("hA", "GET", `/posts/${pAll}/comments`);
    expect(list.json.comments.find((x: { id: string }) => x.id === w.json.id).moderate).toBe(true);
    expect((await call("hM", "POST", `${path}/hide`, { hidden: true })).status).toBe(200);
    expect(texts(await call("hB", "GET", `/posts/${pAll}/comments`))).not.toContain("Sẽ bị ẩn");
    expect((await call("hA", "POST", `${path}/hide`, { hidden: false })).status).toBe(200);
    expect(texts(await call("hB", "GET", `/posts/${pAll}/comments`))).toContain("Sẽ bị ẩn");
    expect((await call("hA", "DELETE", path)).status).toBe(204);
    expect(texts(await call("hB", "GET", `/posts/${pAll}/comments`))).not.toContain("Sẽ bị ẩn");
  });

  it("nhắc + chuông: B nhắc người đăng A (hM) ⇒ chuông ở A — A (hA) nhắc hB ⇒ chuông ở B — nhắc người công ty khác ⇒ 422", async () => {
    const m0 = await bells(c.hM, "community.mention");
    const w = await call("hB", "POST", `/posts/${pAll}/comments`, {
      text: "@hM xem giúp",
      mentions: [],
      mentionUserIds: [c.hM],
    });
    expect(w.status).toBe(201);
    expect(w.json.mentionedUsers.map((m: { userId: string }) => m.userId)).toEqual([c.hM]);
    expect(await bells(c.hM, "community.mention")).toBe(m0 + 1);
    const b0 = await bells(c.hB, "community.mention");
    const a = await call("hA", "POST", `/posts/${pAll}/comments`, {
      text: "@hB nhé",
      mentions: [],
      mentionUserIds: [c.hB],
    });
    expect(a.status).toBe(201);
    expect(await bells(c.hB, "community.mention")).toBe(b0 + 1);
    expect(await bells(uB2, "community.mention")).toBe(0);
    // soát #2: người công ty đăng KHÔNG có quyền gói (không thấy bài) ⇒ 422, không ghi
    const noRight = await call("hB", "POST", `/posts/${pAll}/comments`, {
      text: "@A3",
      mentions: [],
      mentionUserIds: [uA3],
    });
    expect(noRight.status).toBe(422);
    const bad = await call("hB", "POST", `/posts/${pAll}/comments`, {
      text: "@C",
      mentions: [],
      mentionUserIds: [uC],
    });
    expect(bad.status).toBe(422);
    // A nhắc người B trên bài «Chỉ nội bộ» ⇒ 422
    const inner = await post("Nội bộ 2", aud("internal"));
    expect(
      (
        await call("hA", "POST", `/posts/${inner}/comments`, {
          text: "@hB",
          mentions: [],
          mentionUserIds: [c.hB],
        })
      ).status,
    ).toBe(422);
  });

  it("gợi ý «@» trên bài công ty kết nối: người có quyền ở A (kèm tên công ty) + đồng nghiệp B, không người công ty khác — bài không thấy ⇒ 404", async () => {
    const r = await call("hB", "GET", `/mentionable-people?postId=${pAll}`);
    expect(r.status).toBe(200);
    const hm = r.json.find((p: { userId: string }) => p.userId === c.hM);
    expect(hm).toMatchObject({ connected: true, tenantId: c.A });
    expect(hm.orgName.length).toBeGreaterThan(0);
    const ids = r.json.map((p: { userId: string }) => p.userId);
    expect(ids).not.toContain(uC);
    expect(ids).not.toContain(c.hB);
    const inner = await post("Nội bộ 3", aud("internal"));
    expect((await call("hB", "GET", `/mentionable-people?postId=${inner}`)).status).toBe(404);
  });

  it("bài nội bộ: người đăng (hM) ẩn + xoá bình luận của người khác, quản trị (hA, không phải người đăng) ẩn + xoá bình luận của nhân viên", async () => {
    const p = await post("Nội bộ ẩn xoá", aud("internal"));
    const byA = await call("hA", "POST", `/posts/${p}/comments`, {
      text: "của quản trị",
      mentions: [],
    });
    const byM = await call("hM", "POST", `/posts/${p}/comments`, {
      text: "của người đăng",
      mentions: [],
    });
    const pa = `/posts/${p}/comments/${byA.json.id}`;
    const pm = `/posts/${p}/comments/${byM.json.id}`;
    expect((await call("hM", "POST", `${pa}/hide`, { hidden: true })).status).toBe(200);
    expect((await call("hA", "POST", `${pm}/hide`, { hidden: true })).status).toBe(200);
    expect((await call("hA", "DELETE", pm)).status).toBe(204);
    expect((await call("hM", "DELETE", pa)).status).toBe(204);
  });

  it("người ngoài cộng đồng (đối tác A) theo luật cũ: không thấy bình luận người công ty B, không thấy tên người B được nhắc", async () => {
    const w = await call("hB", "POST", `/posts/${pAll}/comments`, {
      text: "B nói riêng",
      mentions: [],
    });
    expect(w.status).toBe(201);
    const r = await call("s1a", "GET", `/posts/${pAll}/comments`);
    expect(r.status).toBe(200);
    expect(texts(r)).not.toContain("B nói riêng");
    expect(JSON.stringify(r.json)).not.toContain(c.hB);
  });

  it("số câu SQL cố định khi tải danh sách bình luận chéo (2 câu, 3 hay 30 bình luận)", async () => {
    let n = 0;
    const counting = (tx: Tx): Tx =>
      new Proxy(tx, {
        get(t, k, r) {
          const v = Reflect.get(t, k, r);
          if (k !== "execute") return v;
          return (...x: unknown[]) => {
            n++;
            return (v as (...y: unknown[]) => unknown).apply(t, x);
          };
        },
      });
    const cu = createPackUow(db, "community", (tx) => ({ tx: counting(tx) })) as never;
    const a = {
      who: { tenantId: c.B, userId: c.hB, userKind: "internal", extOrgId: null },
      org: null,
    } as unknown as Access;
    const page = { cursor: null, limit: 50 };
    await list.list(cu, a, pAll, page);
    const few = n;
    for (let i = 0; i < 30; i++)
      await own`insert into community.comments (tenant_id, post_id, author_user_id, author_name, text_raw, text_masked)
        values (${c.A}, ${pAll}, ${c.hM}, 'A', ${`số ${i}`}, ${`số ${i}`})`;
    n = 0;
    const r = await list.list(cu, a, pAll, page);
    expect(r.rows.length).toBeGreaterThan(30);
    expect(n).toBe(few);
    expect(few).toBe(2);
  });

  it("ngắt kết nối ⇒ B không xem/không viết nữa, bài + bình luận cũ biến khỏi bảng tin — nối lại ⇒ hiện lại", async () => {
    await setLink(false);
    expect((await call("hB", "GET", `/posts/${pAll}/comments`)).status).toBe(404);
    expect(
      (await call("hB", "POST", `/posts/${pAll}/comments`, { text: "sau ngắt", mentions: [] }))
        .status,
    ).toBe(404);
    const feed = await call("hB", "GET", "/feed");
    expect(JSON.stringify(feed.json)).not.toContain(pAll);
    await setLink(true);
    expect((await call("hB", "GET", `/posts/${pAll}/comments`)).status).toBe(200);
  });
});
