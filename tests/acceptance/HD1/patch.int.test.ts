// HD-FR-07 · HD-FR-06 · HD-FR-02 · HD-AC06 · HD-AC07 · HD-AC09 · HD-AC01 · D-13 · plan §5: PATCH /contracts/:id/fields.
// Khoá lạc quan `version` (409), FOR UPDATE một hàng, event `field_edited` + outbox CÙNG tx, validate 422, quyền editor.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  arrange,
  CBASE,
  type CRow,
  type CtxN1,
  captureSql,
  cid,
  FIELD_KEYS,
  GHOST,
  insContract,
  listOf,
  mkFields,
  P,
  startHd1,
  T,
} from "./_support/hd1";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});
type Who = (typeof P)[keyof typeof P];
const patch = (p: Who, id: string, body: unknown) =>
  c.hubCall(p, "PATCH", `${CBASE}/${id}/fields`, body);
const base = () =>
  mkFields({ total_value: 500_000_000, number: "HD-1", notice_days: 30 }, { quote: "Điều 5" });

// CR-097 K1: HĐ đã xác nhận (active) bị khoá ⇒ PATCH trường pháp lý 409 (tests/acceptance/K1). Sửa tay ở đây là HĐ Chờ duyệt.
async function arrangeOne(extra: Partial<CRow> = {}) {
  await arrange(c);
  await insContract(c.sql, {
    id: cid(1),
    tenant: T.acme,
    title: "HĐ A",
    status: "needs_review",
    fields: base(),
    ...extra,
  });
  await insContract(c.sql, {
    id: cid(2),
    tenant: T.beta,
    title: "HĐ B",
    status: "needs_review",
    fields: base(),
  });
}
type State = {
  version: number;
  fields: Record<string, { value: unknown; quote: string; verified: boolean; edited: boolean }>;
  events: number;
  outbox: number;
};
async function state(id = cid(1)): Promise<State> {
  const [r] = await c.sql`select version, fields, updated_at,
    (select count(*)::int from contracts.contract_events where contract_id = ${id}) as events,
    (select count(*)::int from contracts.index_outbox) as outbox from contracts.contracts where id = ${id}`;
  return r as unknown as State;
}

describe("HD-AC06 · PATCH trường — sửa tay", () => {
  it("HD-AC06 · PATCH total_value ⇒ 200, edited=true, verified=true, quote GIỮ, version 1→2; phản hồi {id, version, updated_at, fields}", async () => {
    await arrangeOne();
    const r = await patch(P.hoa, cid(1), { version: 1, fields: { total_value: 750_000_000 } });
    expect(r.status).toBe(200);
    expect(Object.keys(r.json).sort()).toEqual(["fields", "id", "updated_at", "version"]);
    expect({ id: r.json.id, version: r.json.version }).toEqual({ id: cid(1), version: 2 });
    expect(r.json.fields.total_value).toEqual({
      value: 750_000_000,
      quote: "Điều 5",
      verified: true,
      edited: true,
    });
    expect(Object.keys(r.json.fields).sort()).toEqual([...FIELD_KEYS].sort());
    const s = await state();
    expect(s.version).toBe(2);
    expect(s.fields.total_value).toEqual({
      value: 750_000_000,
      quote: "Điều 5",
      verified: true,
      edited: true,
    });
    expect(s.fields.number?.edited).toBe(false); // khoá không sửa giữ nguyên
  });
  it("HD-AC06 · ghi 1 event field_edited (actor=người sửa, data.changes có khoá + cũ + mới) và đúng 1 hàng outbox {contract, upsert}", async () => {
    await arrangeOne();
    await patch(P.hoa, cid(1), { version: 1, fields: { total_value: 750_000_000 } });
    const ev =
      await c.sql`select type, actor_user_id, data, tenant_id from contracts.contract_events where contract_id = ${cid(1)}`;
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      type: "field_edited",
      actor_user_id: P.hoa.id,
      tenant_id: T.acme,
    });
    expect(ev[0]?.data.changes).toEqual([
      { key: "total_value", old: 500_000_000, new: 750_000_000 },
    ]);
    const ob =
      await c.sql`select entity, op, tenant_id, entity_id, processed_at from contracts.index_outbox`;
    expect(ob).toHaveLength(1);
    expect(ob[0]).toMatchObject({
      entity: "contract",
      op: "upsert",
      tenant_id: T.acme,
      entity_id: cid(1),
      processed_at: null,
    });
  });
  it("D-07 · sửa tay cập nhật cột sinh: danh sách thấy giá trị mới (value, buyer) và tìm q theo tên mới", async () => {
    await arrangeOne();
    await patch(P.hoa, cid(1), {
      version: 1,
      fields: { total_value: 750_000_000, buyer_name: "Công ty Mới" },
    });
    const row = (await listOf(c, P.tam, { q: "công ty mới" })).json.items[0];
    expect({ id: row?.id, buyer: row?.buyer, value: Number(row?.value) }).toEqual({
      id: cid(1),
      buyer: "Công ty Mới",
      value: 750_000_000,
    });
  });
  it("HD-AC06 · nhiều khoá: một event gom đủ thay đổi, khoá y cũ bị bỏ, version tăng đúng 1", async () => {
    await arrangeOne();
    const r = await patch(P.hoa, cid(1), {
      version: 1,
      fields: { number: "HD-2", notice_days: 60, total_value: 500_000_000 },
    });
    expect(r.status).toBe(200);
    const s = await state();
    expect([s.version, s.events, s.outbox]).toEqual([2, 1, 1]);
    const [ev] =
      await c.sql`select data from contracts.contract_events where contract_id = ${cid(1)}`;
    expect(((ev?.data?.changes ?? []) as { key: string }[]).map((x) => x.key).sort()).toEqual([
      "notice_days",
      "number",
    ]);
    expect(s.fields.total_value?.edited).toBe(false); // y cũ ⇒ không bật edited
  });
  it("HD-AC06 · không thay đổi gì (giá trị y cũ) ⇒ 200, version GIỮ, không event, không outbox", async () => {
    await arrangeOne();
    const before = await state();
    const r = await patch(P.hoa, cid(1), {
      version: 1,
      fields: { number: "HD-1", notice_days: 30 },
    });
    const after = await state();
    expect(r.status).toBe(200);
    expect({ v: r.json.version, ver: after.version, ev: after.events, ob: after.outbox }).toEqual({
      v: 1,
      ver: before.version,
      ev: 0,
      ob: 0,
    });
  });
  it("HD-AC06 · xoá giá trị (null) là một thay đổi: value null, edited true", async () => {
    await arrangeOne();
    const r = await patch(P.hoa, cid(1), { version: 1, fields: { notice_days: null } });
    expect(r.status).toBe(200);
    expect(r.json.fields.notice_days).toMatchObject({ value: null, edited: true });
  });
  it("HD-FR-02 · sửa đủ 23 khoá một lượt: 200, cả 23 khoá edited=true, 1 event với 23 thay đổi", async () => {
    await arrangeOne();
    const all = {
      number: "N",
      title: "T",
      type: "service",
      supplier_name: "S",
      supplier_tax_id: "0100",
      supplier_address: "addr",
      supplier_representative: "R1",
      buyer_name: "B",
      buyer_tax_id: "0200",
      buyer_representative: "R2",
      signed_date: "2026-01-01",
      start_date: "2026-02-01",
      end_date: "2027-02-01",
      effective_date: "2026-02-01",
      auto_renew: true,
      notice_days: 45,
      total_value: 1000,
      vat_rate: 8,
      vat_included: false,
      payment_terms: "pt",
      delivery_terms: "dt",
      warranty: "w",
      penalty: "p",
    };
    const r = await patch(P.hoa, cid(1), { version: 1, fields: all });
    expect(r.status).toBe(200);
    expect(Object.values(r.json.fields).every((f) => (f as { edited: boolean }).edited)).toBe(true);
    const [ev] =
      await c.sql`select jsonb_array_length(data->'changes')::int as n from contracts.contract_events where contract_id = ${cid(1)}`;
    expect(ev?.n).toBe(23);
  });
});

describe("HD-AC06 · 409 CONTRACT_STALE (khoá lạc quan)", () => {
  it("HD-AC06 · version cũ ⇒ 409 CONTRACT_STALE; DB không đổi (version, fields, event, outbox)", async () => {
    await arrangeOne();
    expect(
      (await patch(P.hoa, cid(1), { version: 1, fields: { total_value: 750_000_000 } })).status,
    ).toBe(200);
    const before = await state();
    const r = await patch(P.hoa, cid(1), { version: 1, fields: { total_value: 1 } });
    expect({ status: r.status, code: r.json?.error?.code }).toEqual({
      status: 409,
      code: "CONTRACT_STALE",
    });
    expect(await state()).toEqual(before);
  });
  it("HD-AC06 · version tương lai (lớn hơn hiện tại) cũng ⇒ 409, không ghi", async () => {
    await arrangeOne();
    const r = await patch(P.hoa, cid(1), { version: 5, fields: { total_value: 1 } });
    expect([r.status, r.json?.error?.code]).toEqual([409, "CONTRACT_STALE"]);
    expect((await state()).version).toBe(1);
  });
  it("HD-AC06 · version đúng lần lượt 1→2→3 đều được; mỗi lần 1 event", async () => {
    await arrangeOne();
    expect((await patch(P.hoa, cid(1), { version: 1, fields: { number: "A" } })).json.version).toBe(
      2,
    );
    expect((await patch(P.hoa, cid(1), { version: 2, fields: { number: "B" } })).json.version).toBe(
      3,
    );
    const s = await state();
    expect([s.version, s.events, s.outbox]).toEqual([3, 2, 2]);
  });
  it("HD-AC06 · 8 PATCH đồng thời cùng version=1 (mỗi cái đặt notice_days khác nhau) ⇒ đúng 1×200 và 7×409; không mất cập nhật", async () => {
    await arrangeOne();
    const rs = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        patch(P.hoa, cid(1), { version: 1, fields: { notice_days: 100 + i } }),
      ),
    );
    const ok = rs.filter((r) => r.status === 200);
    const stale = rs.filter((r) => r.status === 409 && r.json?.error?.code === "CONTRACT_STALE");
    expect([ok.length, stale.length]).toEqual([1, 7]);
    const s = await state();
    expect([s.version, s.events, s.outbox]).toEqual([2, 1, 1]);
    expect(s.fields.notice_days?.value).toBe(ok[0]?.json.fields.notice_days.value);
  });
  it("plan §5 · đường ghi dùng SELECT … FOR UPDATE một hàng TRƯỚC khi UPDATE (khoá hàng, không đọc-rồi-ghi trần)", async () => {
    await arrangeOne();
    const { queries } = await captureSql(c, () =>
      patch(P.hoa, cid(1), { version: 1, fields: { notice_days: 99 } }),
    );
    const texts = queries.map((q) => q.text.replace(/\s+/g, " ").toLowerCase());
    const lock = texts.findIndex((t) => /\bfor update\b/.test(t));
    const upd = texts.findIndex((t) => /\bupdate contracts\.contracts\b/.test(t));
    expect({ hasLock: lock >= 0, hasUpdate: upd >= 0, lockFirst: lock >= 0 && lock < upd }).toEqual(
      { hasLock: true, hasUpdate: true, lockFirst: true },
    );
  });
});

describe("HD-AC07 · validate ⇒ 422", () => {
  const untouched = async () => {
    const s = await state();
    expect([s.version, s.events, s.outbox]).toEqual([1, 0, 0]);
    expect(s.fields.total_value?.value).toBe(500_000_000);
  };
  it("HD-AC07 · khoá lạ ⇒ 422 FIELD_UNKNOWN, details.keys liệt kê khoá lạ; lẫn khoá hợp lệ cũng không ghi gì", async () => {
    await arrangeOne();
    const r = await patch(P.hoa, cid(1), { version: 1, fields: { khong_co: 1, total_value: 1 } });
    expect([r.status, r.json?.error?.code]).toEqual([422, "FIELD_UNKNOWN"]);
    expect(r.json?.error?.details?.keys).toEqual(["khong_co"]);
    await untouched();
  });
  it("HD-AC07 · notice_days='abc' ⇒ 422 FIELD_INVALID, details.key='notice_days'", async () => {
    await arrangeOne();
    const r = await patch(P.hoa, cid(1), { version: 1, fields: { notice_days: "abc" } });
    expect([r.status, r.json?.error?.code, r.json?.error?.details?.key]).toEqual([
      422,
      "FIELD_INVALID",
      "notice_days",
    ]);
    await untouched();
  });
  it("HD-AC07 · sai kiểu/miền khác ⇒ 422 FIELD_INVALID: date 31/12/2026, 2027-02-30 · enum 'lease' · int âm / lẻ · bool 'yes' · float 101 · text 2001 ký tự", async () => {
    await arrangeOne();
    const bad: Record<string, unknown>[] = [
      { end_date: "31/12/2026" },
      { end_date: "2027-02-30" },
      { type: "lease" },
      { total_value: -5 },
      { total_value: 1.5 },
      { auto_renew: "yes" },
      { vat_rate: 101 },
      { buyer_name: "x".repeat(2001) },
      { notice_days: 3651 },
    ];
    for (const f of bad) {
      const r = await patch(P.hoa, cid(1), { version: 1, fields: f });
      expect({ f, status: r.status, code: r.json?.error?.code }).toEqual({
        f,
        status: 422,
        code: "FIELD_INVALID",
      });
    }
    await untouched();
  });
  it("HD-AC07 · thân sai hình (thiếu version, fields rỗng {}, version 0, version lẻ, khoá thừa ở gốc) ⇒ 400 hoặc 422, không ghi", async () => {
    await arrangeOne();
    for (const body of [
      { fields: { number: "A" } },
      { version: 1, fields: {} },
      { version: 0, fields: { number: "A" } },
      { version: 1.5, fields: { number: "A" } },
      { version: 1, fields: { number: "A" }, tenant_id: T.beta },
    ]) {
      const r = await patch(P.hoa, cid(1), body);
      expect({ body, ok: [400, 422].includes(r.status) }).toEqual({ body, ok: true });
    }
    await untouched();
  });
});

describe("HD-AC09 · quyền ghi (editor) và cách ly tenant (HD-AC01)", () => {
  it("HD-AC09 · viewer (tam) PATCH ⇒ 403 PACK_FORBIDDEN; DB không đổi; editor (hoa) và owner (lan) được", async () => {
    await arrangeOne();
    const v = await patch(P.tam, cid(1), { version: 1, fields: { number: "X" } });
    expect([v.status, v.json?.error?.code]).toEqual([403, "PACK_FORBIDDEN"]);
    const none = await patch(P.cuc, cid(1), { version: 1, fields: { number: "X" } });
    expect(none.status).toBe(403);
    const s = await state();
    expect([s.version, s.events, s.outbox, s.fields.number?.value]).toEqual([1, 0, 0, "HD-1"]);
    expect((await patch(P.hoa, cid(1), { version: 1, fields: { number: "E" } })).status).toBe(200);
    expect((await patch(P.lan, cid(1), { version: 2, fields: { number: "O" } })).status).toBe(200);
  });
  it("HD-AC09 · quyền được kiểm TRƯỚC khi đọc: viewer gửi khoá lạ vẫn 403 (không lộ 422)", async () => {
    await arrangeOne();
    const r = await patch(P.tam, cid(1), { version: 1, fields: { khong_co: 1 } });
    expect(r.status).toBe(403);
  });
  it("HD-AC01 · owner tenant B PATCH HĐ của A ⇒ 404 NOT_FOUND, giống hệt id lạ; DB của A không đổi", async () => {
    await arrangeOne();
    const other = await patch(P.an, cid(1), { version: 1, fields: { total_value: 1 } });
    const ghost = await patch(P.an, GHOST, { version: 1, fields: { total_value: 1 } });
    expect({ s: other.status, c: other.json?.error?.code }).toEqual({ s: 404, c: "NOT_FOUND" });
    expect({ s: other.status, b: other.json }).toEqual({ s: ghost.status, b: ghost.json });
    const s = await state();
    expect([s.version, s.events, s.outbox, s.fields.total_value?.value]).toEqual([
      1, 0, 0, 500_000_000,
    ]);
  });
  it("HD-AC01 · thân giả tenant_id=beta (editor acme) bị bỏ qua hoặc từ chối; HĐ của beta không đổi", async () => {
    await arrangeOne();
    await patch(P.hoa, cid(1), { version: 1, fields: { number: "Z" }, tenant_id: T.beta });
    const [b] = await c.sql`select version from contracts.contracts where id = ${cid(2)}`;
    expect(b?.version).toBe(1);
  });
});

describe("HD-FR-06 · một giao dịch: event + outbox cùng tx với thay đổi", () => {
  it("HD-FR-06 · event/outbox lỗi (trigger ném) ⇒ 5xx và KHÔNG có gì được ghi (fields, version, event, outbox)", async () => {
    await arrangeOne();
    await c.sql.unsafe(
      `create or replace function contracts.hd1_boom() returns trigger language plpgsql as $$ begin raise exception 'hd1 boom'; end $$`,
    );
    await c.sql.unsafe(
      "create trigger hd1_boom before insert on contracts.contract_events for each row execute function contracts.hd1_boom()",
    );
    try {
      const r = await patch(P.hoa, cid(1), { version: 1, fields: { total_value: 750_000_000 } });
      expect(r.status).toBeGreaterThanOrEqual(500);
      const s = await state();
      expect([s.version, s.events, s.outbox, s.fields.total_value?.value]).toEqual([
        1, 0, 0, 500_000_000,
      ]);
    } finally {
      await c.sql.unsafe("drop trigger if exists hd1_boom on contracts.contract_events");
      await c.sql.unsafe("drop function if exists contracts.hd1_boom()");
    }
  });
});
