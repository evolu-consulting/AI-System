// CR-152 cr152c · int (DB thật): điểm uy tín của Nhượng quyền + Hợp tác có chia — ô theo chiều tiền / chia tiền, vai đối tác, nguồn mốc kỳ
// (đúng hạn vs trễ), «không chia» không tính, người được giao (≠ người tạo) chấm được, tenant khác không thấy, SỐ CÂU SQL cố định.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { type Cast, seedCast } from "../../../../../../tests/acceptance/com-c3/_support/cast";
import { createPackUow } from "../kit/adapters/pack-uow";
import { contractStateRepo, registerContractDoneHook } from "./adapters/contract-state.repo";
import { kindScheduleDoneHook } from "./adapters/kind-schedule.hook";
import { scoreRows } from "./adapters/rep.sql";
import { cellsOf } from "./application/reputation.usecase";
import { board } from "./domain/rep-board.rules";
import { REP_ROLES } from "./domain/rep-config.rules";
import { resolveConfig } from "./domain/rep-normalise.rules";

let o: Sql;
let db: Db;
let c: Cast;
const TODAY = "2026-11-14";
const fld = (v: string) => ({ value: v, quote: "", verified: true, edited: true });

async function draft(
  deal: string,
  dir: string,
  name: string,
  terms: object,
  start: string,
  end: string,
) {
  const [r] = await o<{ id: string }[]>`insert into contracts.contracts ${o({
    tenant_id: c.A,
    title: `HĐ điểm CR-152 ${deal} ${name}`,
    created_by: c.hM,
    owner_user_id: c.hA,
    status: "draft",
    kind: "contract",
    doc_type: "contract",
    deal,
    direction: dir,
    kind_terms: o.json(terms as never),
    fields: o.json({
      start_date: fld(start),
      end_date: fld(end),
      buyer_name: fld(name),
      supplier_name: fld(name),
    } as never),
  } as never)} returning id`;
  return (r as { id: string }).id;
}
const uow = () => createPackUow(db, "contracts", (tx, t) => ({ st: contractStateRepo(tx, t), tx }));
const toDone = (id: string) =>
  uow().tenant({ tenantId: c.A, userId: c.hA }, async (r) =>
    r.st.applyTransition({ contractId: id, ev: "submit", actorId: c.hA, ctx: { hasFlow: false } }),
  );
/** Xác nhận mốc (trừ nhắc gia hạn): đúng hạn; mốc phí có kỳ trễ 5 ngày, lỗi đối tác. */
const settleAll = (id: string, lateKind: string | null, lateDays: number) =>
  o`update contracts.obligations set status = 'done',
      done_at = due_date + (case when kind = ${lateKind ?? ""} and period_key is not null then ${lateDays}::int else 0 end),
      fault = case when kind = ${lateKind ?? ""} and period_key is not null and ${lateDays}::int > 0 then 'partner' end
    where contract_id = ${id} and kind <> 'renewal' and status <> 'replaced'`;
/** Khoá đối tác đúng như HĐ lưu (`party_key`, bỏ dấu + gập). */
const keyOf = async (name: string) =>
  (
    (await o<{ k: string }[]>`select contracts.party_key(${name}::text, null::text) as k`)[0] as {
      k: string;
    }
  ).k;

type Row = { party: string; role: string; score: number | null; level: string };
async function boardOf(tenantId: string, userId: string) {
  let q = 0;
  const rows = await uow().tenant({ tenantId, userId }, async ({ tx }) => {
    const cfg = resolveConfig([]);
    const r = await scoreRows(tx, tenantId, { today: TODAY, cells: cellsOf(cfg), party: null });
    q = 2; // scoreRows = hai câu (A) + (B), cố định
    return board(r, cfg, REP_ROLES) as unknown as Row[];
  });
  return { rows, q };
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  c = await seedCast(o, 153);
  db = createDb(urls().hubApi, { max: 3 });
  registerContractDoneHook(kindScheduleDoneHook, "mốc-loại-HĐ");
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-152 · điểm uy tín Nhượng quyền / Hợp tác", () => {
  it("Nhượng quyền (mình nhượng quyền): đối tác = Bên nhận quyền, báo cáo đúng hạn + phí trễ lỗi đối tác ⇒ 96, mình nhận quyền ⇒ chưa có điểm", async () => {
    const A = "Công ty Nhận Quyền Điểm";
    const B = "Công ty Nhượng Quyền Điểm";
    const [kA, kB] = await Promise.all([keyOf(A), keyOf(B)]);
    const FR = {
      brand: "Cà Phê Mẫu",
      initial_fee: 300_000_000,
      fee_basis: "revenue_pct",
      fee_pct: 5,
      period: "month",
    };
    const a = await draft(
      "franchise",
      "sale",
      A,
      { ...FR, role: "franchisor" },
      "2026-01-01",
      "2026-03-31",
    );
    const b = await draft(
      "franchise",
      "purchase",
      B,
      { ...FR, role: "franchisee" },
      "2026-01-01",
      "2026-03-31",
    );
    for (const id of [a, b]) await toDone(id);
    const cells = await o<
      { id: string; rep_cell: number }[]
    >`select id, rep_cell from contracts.contracts where id in ${o([a, b])}`;
    expect(cells.find((x) => x.id === a)?.rep_cell).toBe(6);
    expect(cells.find((x) => x.id === b)?.rep_cell).toBe(7);
    const roles = await o<
      { party_key: string; role: string }[]
    >`select party_key, role from contracts.partner_roles
      where party_key in ${o([kA, kB])}`;
    expect(roles.find((x) => x.party_key === kA)?.role).toBe("franchisee");
    expect(roles.find((x) => x.party_key === kB)?.role).toBe("franchisor");
    await settleAll(a, "payment", 5);
    await settleAll(b, "payment", 5);
    // N2: người được giao (hA), KHÔNG phải người tạo (hM), chấm được.
    const { rows } = await boardOf(c.A, c.hA);
    const ra = rows.find((x) => x.party === kA && x.role === "franchisee");
    expect(ra?.score).toBe(96);
    const rb = rows.find((x) => x.party === kB && x.role === "franchisor");
    expect(rb?.score ?? null).toBeNull();
  });

  it("Hợp tác có chia: đối soát đúng hạn + trễ lỗi đối tác ⇒ điểm, «không chia» không vai, không ô, tenant khác không thấy", async () => {
    const P = "Công ty Hợp Tác Điểm";
    const N = "Công ty Hợp Tác Không Chia";
    const [kP, kN] = await Promise.all([keyOf(P), keyOf(N)]);
    const kA = await keyOf("Công ty Nhận Quyền Điểm");
    const co = {
      scope: "Dự án mẫu",
      split_basis: "profit",
      our_share_pct: 60,
      settle_period: "quarter",
    };
    const a = await draft("cooperation", "sale", P, co, "2026-01-01", "2026-12-31");
    const n = await draft(
      "cooperation",
      "sale",
      N,
      { scope: "Ghi nhớ", split_basis: "none" },
      "2026-01-01",
      "2026-12-31",
    );
    for (const id of [a, n]) await toDone(id);
    const cell = await o<
      { id: string; rep_cell: number | null }[]
    >`select id, rep_cell from contracts.contracts where id in ${o([a, n])}`;
    expect(cell.find((x) => x.id === a)?.rep_cell).toBe(8);
    expect(cell.find((x) => x.id === n)?.rep_cell).toBeNull();
    const none = await o`select 1 from contracts.partner_roles where party_key = ${kN}`;
    expect(none.length).toBe(0);
    // Đối soát Q1 đúng hạn, Q2 trễ 4 ngày lỗi đối tác; Q3–Q4 còn mở.
    await o`update contracts.obligations set status = 'done', done_at = due_date + (case when period_key = '2026-Q2' then 4 else 0 end),
        fault = case when period_key = '2026-Q2' then 'partner' end
      where contract_id = ${a} and period_key in ('2026-Q1', '2026-Q2')`;
    const { rows, q } = await boardOf(c.A, c.hA);
    const r = rows.find((x) => x.party === kP && x.role === "cooperator");
    // Q1 (done 10/4, cũ hơn 6 tháng ⇒ h = 0,5) 100 + Q2 (done 14/7, h = 1) 92 ⇒ (50 + 92) / 1,5 = 94,67.
    expect(r?.score).toBe(95);
    expect(rows.some((x) => x.party === kN)).toBe(false);
    expect(q).toBe(2);
    const other = await boardOf(c.B, c.hB);
    expect(other.rows.some((x) => x.party === kP || x.party === kA)).toBe(false);
  });
});
