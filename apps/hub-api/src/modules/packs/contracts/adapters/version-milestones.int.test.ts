// CR-127 K5 · BR-35/36/36a/36b · spec §3 "Phiên bản", §4 (changes-since-last, versions/diff + text): (DB thật, role gói `contracts_rw` + RLS)
// (1) v(n+1) vào DONE qua cổng ⇒ mốc `open` của v(n) chuyển sang v(n+1) (giữ id, kèm dòng giao `milestone_items`), mốc đã xong ở lại v(n),
//     v(n) "đã thay"; cổng từ chối (CAS) ⇒ không chuyển gì. (2) diff hai phiên bản + điều khoản (`text=1`). (3) changes-since-last: có / không
//     đổi, điều khoản được nhắc. (4) chặn chéo tenant (404 / không chuyển mốc của tenant khác).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { contracts, tenants, users, visibility } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../../lib/db";
import { createPackUow } from "../../kit/adapters/pack-uow";
import { packTenantOnly } from "../../kit/public";
import { changesSinceLastOf } from "../application/changes-since-last.usecase";
import { versionDiff } from "../application/version-diff.usecase";
import { contractStateRepo } from "./contract-state.repo";
import { changesRepo, versionDiffRepo } from "./versions.routes";

let o: Sql;
let db: Db;
let T = "";
let U = "";
let T2 = "";
let U2 = "";
let U3 = "";

const uow = () => createPackUow(db, "contracts", (tx, tid) => ({ st: contractStateRepo(tx, tid) }));
const who = () => ({ tenantId: T, userId: U });
const who3 = () => ({ tenantId: T, userId: U3 });
const who2 = () => ({ tenantId: T2, userId: U2 });
const diffUc = () =>
  versionDiff({ uow: packTenantOnly(createPackUow(db, "contracts", versionDiffRepo)) });
const changesUc = () =>
  changesSinceLastOf({ uow: packTenantOnly(createPackUow(db, "contracts", changesRepo)) });

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  [T, T2] = (await tenants(o, 2, 9127)) as [string, string];
  [U] = (await users(o, T, 1, { from: 9127 })) as [string];
  [U2] = (await users(o, T2, 1, { from: 9227 })) as [string];
  [U3] = (await users(o, T, 1, { from: 9327 })) as [string];
  await visibility(o, [T, T2], "tenant");
});
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

/** Chuỗi 2 phiên bản: v1 DONE (đã khoá), v2 PROCESSING (cùng chuỗi, `supersedes_id = v1`). `from` tách id giữa các ca. */
async function chain(tenant: string, user: string, from: number) {
  const [v1] = await contracts(o, tenant, 1, { createdBy: user, from, status: "done" });
  const [v2] = await contracts(o, tenant, 1, {
    createdBy: user,
    from: from + 1,
    status: "processing",
  });
  await o`update contracts.contracts set root_id = ${v1 as string}, version_no = 2, supersedes_id = ${v1 as string}
    where id = ${v2 as string}`;
  return { v1: v1 as string, v2: v2 as string };
}
const ob = async (tenant: string, contract: string, seq: number, status: "open" | "done") => {
  const [r] = await o<{ id: string }[]>`insert into contracts.obligations
    (tenant_id, contract_id, party_key, direction, kind, seq, due_date, amount, status, done_at, source, title)
    values (${tenant}, ${contract}, 'p', 'pay', 'payment', ${seq}, '2099-01-01', 100, ${status},
      ${status === "done" ? "2026-01-01" : null}::date, 'manual', ${`Mốc ${seq}`}) returning id::text`;
  return (r as { id: string }).id;
};
const where = async (ids: string[]) =>
  Object.fromEntries(
    (
      await o<
        { id: string; contract_id: string }[]
      >`select id::text, contract_id::text from contracts.obligations
        where id in ${o(ids)}`
    ).map((r) => [r.id, r.contract_id]),
  );

describe("K5 · BR-36b chuyển mốc mở khi v(n+1) vào DONE", () => {
  it("mốc mở sang v2 (kèm dòng giao); mốc xong ở lại v1; v1 đã thay; sự kiện milestones_moved", async () => {
    const { v1, v2 } = await chain(T, U, 100);
    const a = await ob(T, v1, 1, "open");
    const b = await ob(T, v1, 2, "open");
    const c = await ob(T, v1, 3, "done");
    await o`insert into contracts.milestone_items (tenant_id, contract_id, milestone_id, contract_item_id, qty)
      values (${T}, ${v1}, ${a}, ${crypto.randomUUID()}, 5)`;
    const r = await uow().tenant(who(), (x) =>
      x.st.applyTransition({ contractId: v2, ev: "flow_approved", actorId: U }),
    );
    expect(r).toMatchObject({ ok: true, to: "done" });
    const at = await where([a, b, c]);
    expect(at[a]).toBe(v2);
    expect(at[b]).toBe(v2);
    expect(at[c]).toBe(v1);
    const [mi] = await o<
      { contract_id: string }[]
    >`select contract_id::text from contracts.milestone_items
      where milestone_id = ${a}`;
    expect(mi?.contract_id).toBe(v2);
    const [old] = await o<
      { sup: boolean }[]
    >`select superseded_at is not null as sup from contracts.contracts where id = ${v1}`;
    expect(old?.sup).toBe(true);
    const [ev] = await o<{ data: { moved: number } }[]>`select data from contracts.contract_events
      where contract_id = ${v2} and type = 'milestones_moved'`;
    expect(ev?.data.moved).toBe(2);
    // trigger cũ không còn huỷ mốc nào
    const [cx] = await o<{ n: string }[]>`select count(*)::text as n from contracts.obligations
      where contract_id in (${v1}, ${v2}) and status = 'cancelled'`;
    expect(cx?.n).toBe("0");
  });

  it("hàng con còn mở của mốc cha ĐÃ XONG: cha ở lại v1, con (mở) sang v2", async () => {
    const { v1, v2 } = await chain(T, U, 150);
    const parent = await ob(T, v1, 1, "done");
    const [ch] = await o<{ id: string }[]>`insert into contracts.obligations
      (tenant_id, contract_id, party_key, direction, kind, seq, due_date, amount, status, source, title, parent_obligation_id)
      values (${T}, ${v1}, 'p', 'pay', 'payment', 2, '2099-01-01', 40, 'open', 'fulfill', 'Phần còn lại', ${parent})
      returning id::text`;
    const child = (ch as { id: string }).id;
    await uow().tenant(who(), (x) =>
      x.st.applyTransition({ contractId: v2, ev: "flow_approved", actorId: U }),
    );
    const at = await where([parent, child]);
    expect(at[parent]).toBe(v1);
    expect(at[child]).toBe(v2);
    const [p] = await o<
      { pid: string | null }[]
    >`select parent_obligation_id::text as pid from contracts.obligations where id = ${child}`;
    expect(p?.pid).toBe(parent);
  });

  it("cổng từ chối (run_id lệch) ⇒ STATE_CONFLICT và KHÔNG chuyển mốc", async () => {
    const { v1, v2 } = await chain(T, U, 200);
    const a = await ob(T, v1, 1, "open");
    const r = await uow().tenant(who(), (x) =>
      x.st.applyTransition({
        contractId: v2,
        ev: "flow_approved",
        actorId: U,
        runId: crypto.randomUUID(),
      }),
    );
    expect(r).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect((await where([a]))[a]).toBe(v1);
  });

  it("chuỗi của tenant khác không bị đụng", async () => {
    const mine = await chain(T, U, 300);
    const other = await chain(T2, U2, 400);
    const m1 = await ob(T, mine.v1, 1, "open");
    const o1 = await ob(T2, other.v1, 1, "open");
    await uow().tenant(who(), (x) =>
      x.st.applyTransition({ contractId: mine.v2, ev: "flow_approved", actorId: U }),
    );
    expect((await where([m1]))[m1]).toBe(mine.v2);
    expect((await where([o1]))[o1]).toBe(other.v1);
  });
});

const V1 = "HỢP ĐỒNG\nĐiều 1. Giá\nGiá 100.\nĐiều 2. Giao\nGiao 30 ngày.";
const V2 = "HỢP ĐỒNG\nĐiều 1. Giá\nGiá 120.\nĐiều 2. Giao\nGiao 30 ngày.";

describe("K5 · BR-36 diff hai phiên bản (+ điều khoản)", () => {
  it("không text ⇒ chỉ trường; text=1 ⇒ điều đổi; tenant khác ⇒ null", async () => {
    const { v1, v2 } = await chain(T, U, 500);
    await o`update contracts.contracts set source_text = ${V1}, fields = ${o.json({ number: { value: "A1" } })} where id = ${v1}`;
    await o`update contracts.contracts set source_text = ${V2}, fields = ${o.json({ number: { value: "A2" } })} where id = ${v2}`;
    const plain = await diffUc()(who(), v1, v1, v2);
    expect(plain?.changes.map((c) => c.key)).toContain("number");
    expect(plain?.clauses).toBeUndefined();
    const withText = await diffUc()(who(), v1, v1, v2, true);
    expect(withText?.clauses?.map((c) => c.ref)).toEqual(["Điều 1"]);
    expect(withText?.clauses?.[0]).toMatchObject({ changed: true });
    expect(await diffUc()(who2(), v1, v1, v2, true)).toBeNull();
  });
});

describe("K5 · BR-36a changes-since-last", () => {
  const sub = (
    c: string,
    round: number,
    fields: Record<string, { value: string }>,
    text: string | null,
    note: string | null,
  ) =>
    o`insert into contracts.contract_submissions (tenant_id, contract_id, round, submitted_by, fields, source_text, return_note)
      values (${T}, ${c}, ${round}, ${U}, ${o.json(fields)}, ${text}, ${note})`;

  it("chưa gửi lần nào ⇒ round 0; một lần ⇒ previous null; hai lần ⇒ trường + điều đổi + yêu cầu lần trước", async () => {
    const [c] = (await contracts(o, T, 1, { createdBy: U, from: 600, status: "processing" })) as [
      string,
    ];
    expect(await changesUc()(who(), c)).toEqual({
      round: 0,
      previous_round: null,
      fields: [],
      clauses: [],
      return_note: null,
    });
    await o`update contracts.contracts set submitted_by = ${U} where id = ${c}`;
    await sub(c, 1, { number: { value: "A1" } }, V1, null);
    expect(await changesUc()(who(), c)).toMatchObject({
      round: 1,
      previous_round: null,
      clauses: [],
    });
    // lần 2: sửa số HĐ + Điều 1; văn bản lưu mới; người Trả lại nhắc Điều 1 và Điều 2
    await sub(c, 2, { number: { value: "A2" } }, V2, "Sửa điều 1 và điều 2 giúp tôi");
    const out = await changesUc()(who(), c);
    expect(out?.round).toBe(2);
    expect(out?.previous_round).toBe(1);
    expect(out?.fields).toEqual([{ key: "number", before: "A1", after: "A2" }]);
    expect(out?.return_note).toBe("Sửa điều 1 và điều 2 giúp tôi");
    expect(out?.clauses.map((x) => [x.ref, x.changed, x.requested])).toEqual([
      ["Điều 1", true, true],
      ["Điều 2", false, true],
    ]);
    expect(await changesUc()(who2(), c)).toBeNull();
    // BR-26: người chỉ xem ⇒ không thấy ý kiến, cờ requested cũng không lộ; quản trị công ty thấy
    const viewer = await changesUc()(who3(), c);
    expect(viewer?.return_note).toBeNull();
    expect(viewer?.clauses.map((x) => [x.ref, x.changed, x.requested])).toEqual([
      ["Điều 1", true, false],
    ]);
    expect(viewer?.fields).toEqual(out?.fields);
    expect((await changesUc()(who3(), c, true))?.return_note).toBe("Sửa điều 1 và điều 2 giúp tôi");
    // người đã quyết ở một bước của HĐ này ⇒ thấy
    await o`insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
      values (${T}, ${c}, 'stage_decided', ${U3}, '{}'::jsonb)`;
    expect((await changesUc()(who3(), c))?.return_note).toBe("Sửa điều 1 và điều 2 giúp tôi");
  });

  it("gửi lại không đổi gì (văn bản không lưu lại) ⇒ không trường / điều đổi; ý kiến vẫn trả", async () => {
    const [c] = (await contracts(o, T, 1, { createdBy: U, from: 700, status: "processing" })) as [
      string,
    ];
    await o`update contracts.contracts set owner_user_id = ${U} where id = ${c}`;
    await sub(c, 1, { number: { value: "A1" } }, V1, null);
    await sub(c, 2, { number: { value: "A1" } }, null, "Điều 5 chưa rõ");
    const out = await changesUc()(who(), c);
    expect(out).toMatchObject({
      round: 2,
      previous_round: 1,
      fields: [],
      clauses: [],
      return_note: "Điều 5 chưa rõ",
    });
  });
});
