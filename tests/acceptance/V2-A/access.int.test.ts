// V2-A · quyền + cách ly tenant của mốc HĐ và cờ duyệt — viết TRƯỚC code. Guard quyền gói trước đọc thân (viewer ghi ⇒ 403,
// không đổi gì); tenant khác ⇒ 404 như không có (không lộ tồn tại); cờ duyệt đọc đúng hàng của tenant trong tx.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  arrangeV2a,
  type CtxN1,
  call,
  d,
  deal,
  ok,
  P,
  restoreApproval,
  rowsOf,
  setApproval,
  startHd1,
  T,
} from "./_support/v2a";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  if (c) await restoreApproval(c.sql);
  await c?.stop();
});

const add = (id: string, p = P.hoa, b: unknown = { kind: "other", due_date: d(5) }) =>
  call(c, p, "POST", `/contracts/${id}/milestones`, b);

describe("V2-A · quyền gói trên mốc", () => {
  it("viewer: thêm/sửa/xoá mốc ⇒ 403, mốc không đổi; editor làm được", async () => {
    await arrangeV2a(c);
    const id = await deal(c.sql, { sale: true });
    const m = await ok(add(id));
    const before = await rowsOf(c.sql, id);
    const r = [
      await add(id, P.tam),
      await call(c, P.tam, "PATCH", `/milestones/${m.id}`, { title: "Đổi" }),
      await call(c, P.tam, "DELETE", `/milestones/${m.id}`),
    ];
    expect(r.map((x) => x.status)).toEqual([403, 403, 403]);
    expect(await rowsOf(c.sql, id)).toEqual(before);
    const p = await ok(call(c, P.hoa, "PATCH", `/milestones/${m.id}`, { title: "Đổi" }));
    expect(p.title).toBe("Đổi");
    const del = await call(c, P.hoa, "DELETE", `/milestones/${m.id}`);
    expect(del.status).toBe(204);
  });

  it("tenant khác: thêm vào HĐ / sửa / xoá / xác nhận mốc của acme ⇒ 404 giống id lạ, không đổi gì", async () => {
    await arrangeV2a(c);
    const id = await deal(c.sql, { sale: true });
    const m = await ok(add(id));
    const before = await rowsOf(c.sql, id);
    const r = [
      await add(id, P.an),
      await call(c, P.an, "PATCH", `/milestones/${m.id}`, { title: "Chiếm" }),
      await call(c, P.an, "DELETE", `/milestones/${m.id}`),
      await call(c, P.an, "POST", `/obligations/${m.id}/settle`, { fault: "partner" }),
      await add(crypto.randomUUID(), P.hoa),
    ];
    expect(r.map((x) => [x.status, x.json?.error?.code])).toEqual([
      [404, "NOT_FOUND"],
      [404, "NOT_FOUND"],
      [404, "NOT_FOUND"],
      [404, "NOT_FOUND"],
      [404, "NOT_FOUND"],
    ]);
    expect(await rowsOf(c.sql, id)).toEqual(before);
  });

  it("id sai dạng ⇒ 400 trước SQL; thân lạ (tenant_id) ⇒ 400", async () => {
    await arrangeV2a(c);
    const id = await deal(c.sql, { sale: true });
    const bad = await call(c, P.hoa, "PATCH", "/milestones/not-a-uuid", { title: "x" });
    const extra = await add(id, P.hoa, { kind: "other", due_date: d(1), tenant_id: T.beta });
    expect([bad.status, extra.status]).toEqual([400, 400]);
  });
});

describe("V2-A · C3 cờ duyệt theo tenant (cách ly)", () => {
  it("tắt duyệt ở acme không ảnh hưởng beta; mặc định theo khoá tenant: demo/nitigroup tắt, còn lại bật", async () => {
    await arrangeV2a(c);
    await setApproval(c.sql, T.acme, false);
    const on = (tid: string) =>
      c.sql.begin(async (tx) => {
        await tx`select set_config('app.tenant_id', ${tid}, true)`;
        const [r] = await tx<{ on: boolean }[]>`select contracts.approval_on() as on`;
        return r?.on;
      });
    expect([await on(T.acme), await on(T.beta)]).toEqual([false, true]);
    const demo = crypto.randomUUID();
    const got = await c.sql
      .begin(async (tx) => {
        await tx`insert into admin.tenants (id, key, name) values (${demo}, 'demo', 'Demo V2-A')`;
        await tx`select set_config('app.tenant_id', ${demo}, true)`;
        const [r] = await tx<{ on: boolean }[]>`select contracts.approval_on() as on`;
        throw Object.assign(new Error("rollback"), { on: r?.on });
      })
      .catch((e: { on?: boolean }) => e.on);
    expect(got).toBe(false);
  });
});
