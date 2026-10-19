// PK-BR-01 · PK-NFR-05 · PK-NFR-01 · PK-AC12 · D-03 · plan §10 bảng "bước nhảy mỗi request": số câu SQL (hook `options.debug` của
// pool), lệnh Redis, HTTP nội bộ/ngoài — cố định theo route, KHÔNG phụ thuộc số hàng. HTTP tới app nội bộ (admin-api…) = 0.
// Lạnh = user lần đầu vào Hub (ConfigCache chưa có) ⇒ các ca "lạnh" chạy TRƯỚC mọi lời gọi khác của user đó (thứ tự file).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { utf8 } from "../FB1/_fbfake";
import {
  type CtxN1,
  countHops,
  type Hops,
  ID,
  itemBody,
  needPackKit,
  P,
  PK,
  seedFile,
  startN1,
  T,
  untilHubSettles,
} from "./_support/n1";

let c: CtxN1;
let itemId = "";
let fileFid = "";
beforeAll(async () => {
  c = await startN1();
});
afterAll(async () => {
  await c?.stop();
});
type Person = (typeof P)[keyof typeof P];
const call = (p: Person, method: string, path: string, body?: unknown) => () =>
  c.hubCall(p, method, path, body);
const noFileSteps = (h: Hops) => ({ redis: h.redis, http: h.http });

describe("PK-AC12 · dựng dữ liệu và làm nóng", () => {
  it("PK-AC12 · điều kiện tiền đề: gói bật cho acme (lan=owner, hoa=editor, tam=viewer, cuc không Group), item 50 con, file", async () => {
    await needPackKit(c.sql);
    await c.sql`truncate pkdemo.item_lines, pkdemo.items, pkdemo.files, pkdemo.index_outbox`;
    await c.enable(T.acme);
    await c.enable(T.beta);
    // dữ liệu dựng bằng owner (không qua Hub) để user thử "lạnh" chưa chạm Hub
    await c.sql`insert into pkdemo.items (id, tenant_id, title) values (${ID.itemA}, ${T.acme}, 'mẫu')`;
    await c.sql`insert into pkdemo.item_lines (tenant_id, item_id, text)
      select ${T.acme}::uuid, ${ID.itemA}::uuid, 'dòng ' || g from generate_series(1, 50) g`;
    itemId = ID.itemA;
    const f = c.fb.put(utf8("nội dung"), "hd.pdf", `t_${T.acme}`);
    fileFid = f.file_id;
    await seedFile(c.sql, T.acme, ID.fileA, fileFid);
    await c.addToRole(T.acme, "owner", [P.lan]);
    await c.addToRole(T.acme, "editor", [P.hoa]);
    await c.addToRole(T.acme, "viewer", [P.tam]);
    await c.addToRole(T.beta, "owner", [P.an]);
    // `an` (user duy nhất đã chạm Hub) báo cache đã nạp xong cấu hình mới
    const a = await untilHubSettles(
      c.hub,
      async () => (await c.hubCall(P.an, "GET", `/pack/${PK}/me`)).json?.actions ?? [],
      (x) => x.length === 3,
    );
    expect(a).toEqual(["read", "write", "admin"]);
  });
});

describe("PK-NFR-01 · kiểm quyền gói: 0 câu khi cache nóng, ≤ 1 khi nguội", () => {
  it("PK-NFR-01 · /me nguội (cuc, lần đầu) ≤ 1 câu SQL; 0 Redis; 0 HTTP", async () => {
    const h = await countHops(c, call(P.cuc, "GET", `/pack/${PK}/me`));
    expect(h.r.status).toBe(200);
    expect(h.sql).toBeLessThanOrEqual(1);
    expect(noFileSteps(h)).toEqual({ redis: [], http: [] });
  });
  it("PK-NFR-01 · /me nóng (cuc, lần 2) = 0 câu SQL, 0 Redis, 0 HTTP", async () => {
    const h = await countHops(c, call(P.cuc, "GET", `/pack/${PK}/me`));
    expect({ status: h.r.status, enabled: h.r.json?.enabled }).toEqual({
      status: 200,
      enabled: true,
    });
    expect(h.queries).toEqual([]);
    expect(h.sql).toBe(0);
    expect(noFileSteps(h)).toEqual({ redis: [], http: [] });
  });
  it("PK-NFR-01 · /me nóng cho mọi vai (owner/editor/viewer) = 0 câu SQL", async () => {
    for (const p of [P.lan, P.hoa, P.tam]) await c.hubCall(p, "GET", `/pack/${PK}/me`); // lần nguội
    const n: { status: number; sql: number }[] = [];
    for (const p of [P.lan, P.hoa, P.tam]) {
      const h = await countHops(c, call(p, "GET", `/pack/${PK}/me`));
      n.push({ status: h.r.status, sql: h.sql });
    }
    expect(n).toEqual([
      { status: 200, sql: 0 },
      { status: 200, sql: 0 },
      { status: 200, sql: 0 },
    ]);
  });
});

describe("PK-NFR-05 · bước nhảy mỗi route pkdemo (plan §10)", () => {
  it("PK-NFR-05 · GET items/:id (cha + 50 con) nguội ≤ 3 câu (2 + 1 nạp user); không N+1", async () => {
    // viewer `tam` đã chạm Hub ở ca trên ⇒ dùng `an`-tương đương: owner beta KHÔNG đọc được acme ⇒ dùng người thuộc acme chưa nguội: không còn.
    // Ca nguội thực sự đã đo ở /me; ở đây đo trần: nguội hoặc nóng đều ≤ 3.
    const h = await countHops(c, call(P.tam, "GET", `/pack/${PK}/items/${itemId}`));
    expect(h.r.status).toBe(200);
    expect(h.r.json.lines?.length).toBe(50);
    expect(h.sql).toBeLessThanOrEqual(3);
  });
  it("PK-NFR-05 · GET items/:id nóng = ĐÚNG 2 câu (set_config role/tenant/user; 1 SELECT cha + json_agg con), 0 Redis, 0 HTTP", async () => {
    const h = await countHops(c, call(P.tam, "GET", `/pack/${PK}/items/${itemId}`));
    expect(h.r.status).toBe(200);
    expect(h.sql).toBe(2);
    expect(h.queries[0]).toMatch(/set_config\('role'/i);
    expect(h.queries[1]).toMatch(/^select/i);
    expect(noFileSteps(h)).toEqual({ redis: [], http: [] });
  });
  it("PK-NFR-05 · số câu GET không phụ thuộc số con: item 1 con và item 50 con đều 2 câu", async () => {
    const one = await c.hubCall(P.hoa, "POST", `/pack/${PK}/items`, itemBody("một con", 1));
    const a = await countHops(c, call(P.tam, "GET", `/pack/${PK}/items/${one.json?.id}`));
    const b = await countHops(c, call(P.tam, "GET", `/pack/${PK}/items/${itemId}`));
    expect([one.status, a.r.status, b.r.status, a.sql, b.sql]).toEqual([201, 200, 200, 2, 2]);
  });
  it("PK-NFR-05 · POST items nóng = ĐÚNG 3 câu (set_config; 1 CTE INSERT cha+con từ MỘT tham số JSON; outbox), 0 Redis, 0 HTTP", async () => {
    const h = await countHops(c, call(P.hoa, "POST", `/pack/${PK}/items`, itemBody("lô", 100)));
    expect(h.r.status).toBe(201);
    expect(h.sql).toBe(3);
    expect(h.queries[0]).toMatch(/set_config\('role'/i);
    expect(h.queries[1]).toMatch(/insert into pkdemo\.items/i);
    expect(h.queries[2]).toMatch(/insert into pkdemo\.index_outbox/i);
    expect(noFileSteps(h)).toEqual({ redis: [], http: [] });
  });
  it("PK-NFR-05 · POST 1 con và 100 con: cùng số câu (3) — không vòng lặp theo hàng", async () => {
    const a = await countHops(c, call(P.hoa, "POST", `/pack/${PK}/items`, itemBody("a", 1)));
    const b = await countHops(c, call(P.hoa, "POST", `/pack/${PK}/items`, itemBody("b", 100)));
    expect([a.r.status, b.r.status, a.sql, b.sql]).toEqual([201, 201, 3, 3]);
  });
  it("PK-NFR-05 · GET files/:id/content nóng = 2 câu SQL + 1 lời gọi ngoài (FileBox /link); 0 Redis; 0 HTTP nội bộ", async () => {
    const before = c.fb.callsTo("link").length;
    const h = await countHops(
      c,
      async () =>
        fetch(`${c.hub.base}/pack/${PK}/files/${ID.fileA}/content`, {
          headers: { authorization: `Bearer ${await c.tok(P.tam)}` },
          redirect: "manual",
        }),
      [c.fb.origin],
    );
    expect(h.r.status).toBe(302);
    expect(h.sql).toBe(2);
    expect(c.fb.callsTo("link").length - before).toBe(1);
    expect({ redis: h.redis, http: h.http }).toEqual({ redis: [], http: [] });
  });
});

describe("PK-AC12 · 0 HTTP tới app nội bộ (D-03)", () => {
  it("PK-AC12 · một API đọc + một API ghi + /me: tổng HTTP nội bộ = 0, Redis = 0 (đọc quyền từ ConfigCache/DB, không gọi admin-api)", async () => {
    const reads = await countHops(c, async () => [
      await c.hubCall(P.lan, "GET", `/pack/${PK}/me`),
      await c.hubCall(P.lan, "GET", `/pack/${PK}/items/${itemId}`),
      await c.hubCall(P.hoa, "POST", `/pack/${PK}/items`, itemBody("ac12", 2)),
    ]);
    expect(reads.r.map((x) => x.status)).toEqual([200, 200, 201]);
    expect({ http: reads.http, httpExt: reads.httpExt, redis: reads.redis }).toEqual({
      http: [],
      httpExt: [],
      redis: [],
    });
    expect(reads.sql).toBe(0 + 2 + 3);
  });
  it("PK-AC12 · mã nguồn module gói không import client HTTP tới admin-api (không fetch/axios/ky tới ADMIN_API)", async () => {
    const { Glob } = await import("bun");
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { ROOT } = await import("./_support/load");
    const base = join(ROOT, "apps/hub-api/src/modules/packs");
    const files = [...new Glob("**/*.ts").scanSync({ cwd: base })].filter(
      (f) => !/\.test\.ts$/.test(f),
    );
    expect(files.length).toBeGreaterThan(0); // module gói có thật
    const bad = files.filter(
      (f) =>
        /ADMIN_API|admin-api|fetch\(/.test(readFileSync(join(base, f), "utf8")) &&
        !/pack-files\.filebox\.ts$|docx/.test(f),
    );
    expect(bad).toEqual([]);
  });
});
