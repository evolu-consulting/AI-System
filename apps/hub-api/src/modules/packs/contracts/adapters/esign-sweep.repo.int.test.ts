// esign-sweep · int đường chính trên DB thật (pool hub_api, role contracts_rw, RLS gói), đồng hồ giả qua tham số `now`:
// kẹt `sending` quá hạn ⇒ `needs_decision` SEND_FAILED + chuông người phụ trách (không gửi lại); `sent` ⇒ nhắc người ký đúng một lần
// mỗi chu kỳ; quá `due_h` ⇒ chuông người phụ trách + trưởng phòng Group chuyển cấp đúng một lần; chuông đúng tenant của HĐ (không lẫn
// tenant khác); số câu SQL mỗi lượt cố định (không phụ thuộc số hàng).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { contracts, department, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { sweepEsignOnce } from "../application/esign-sweep";
import { esignSweepDeps } from "../esign.mount";

let sql: Sql;
let db: Db;
let T1 = "";
let T2 = "";
let O = "";
let S = "";
let B = "";
let O2 = "";
let S2 = "";
let G = "";
const k: string[] = [];
const NOW = new Date();
const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

const step = (o: { remind: number | null; due: number; grp: string | null }) => [
  {
    kind: "esign",
    key: "sign",
    name: "Ký số",
    company_signer: { mode: "owner" },
    partner_signs: false,
    order: "company_first",
    provider: null,
    due_h: o.due,
    remind_every_h: o.remind,
    escalate_group_id: o.grp,
  },
];

async function seed(
  tid: string,
  cid: string,
  o: { st: string; ago: number; signer: string; grp?: string | null },
) {
  const aid = crypto.randomUUID();
  await sql`insert into contracts.approvals (id, tenant_id, contract_id, status, started_by, mode, flow_steps,
      esign_status, esign_at, esign_signer)
    values (${aid}, ${tid}, ${cid}, 'done', ${o.signer}, 'engine',
      ${sql.json(step({ remind: 24, due: 72, grp: o.grp ?? null }) as never)}, ${o.st},
      ${new Date(NOW.getTime() - o.ago * 60_000)}, ${o.signer})`;
  await sql`update contracts.contracts set run_id = ${aid} where id = ${cid}`;
}

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  [T1, T2] = (await tenants(sql, 2, 881)) as [string, string];
  [O, S, B] = (await users(sql, T1, 3, { from: 881 })) as [string, string, string];
  [O2, S2] = (await users(sql, T2, 2, { from: 891 })) as [string, string];
  G = await department(sql, T1, "esc", { head: B, members: [S] });
  k.push(...(await contracts(sql, T1, 5, { from: 881, createdBy: O, owner: O })));
  k.push(...(await contracts(sql, T2, 1, { from: 891, createdBy: O2, owner: O2 })));
  await seed(T1, k[0] as string, { st: "sending", ago: 20, signer: S }); // kẹt
  await seed(T1, k[1] as string, { st: "sent", ago: 25 * 60, signer: S, grp: G }); // nhắc, sau 48 h quá hạn
  await seed(T1, k[2] as string, { st: "sending", ago: 2, signer: S }); // mới claim ⇒ giữ
  await seed(T1, k[3] as string, { st: "sent", ago: 25 * 60, signer: S }); // nhắc thêm (lô nhiều hàng)
  await seed(T1, k[4] as string, { st: "sent", ago: 60, signer: S }); // chưa tới hạn nhắc
  await seed(T2, k[5] as string, { st: "sent", ago: 25 * 60, signer: S2 }); // tenant khác
  // esign-remind-fix · phong bì mở có lượt ký: k[6] công ty order 1 đã ký, đối tác chưa ⇒ chờ đối tác; k[7] đối tác order 1 chưa ký
  // ⇒ chưa tới lượt công ty; k[8] công ty order 1 chưa ký ⇒ nhắc người ký như cũ.
  k.push(...(await contracts(sql, T1, 3, { from: 886, createdBy: O, owner: O })));
  const turns: [boolean, number][] = [
    [true, 1],
    [false, 2],
    [false, 1],
  ];
  for (const [i, [signed, order]] of turns.entries()) {
    const cid = k[6 + i] as string;
    await seed(T1, cid, { st: "sent", ago: 25 * 60, signer: S });
    const company = {
      role: "company",
      order,
      client_user_id: S,
      status: signed ? "completed" : "sent",
      signed_at: signed ? NOW.toISOString() : null,
    };
    const partner = {
      role: "partner",
      order: 3 - order,
      client_user_id: null,
      status: "sent",
      signed_at: null,
    };
    await sql`insert into contracts.esign_envelopes (tenant_id, contract_id, provider, envelope_id, status, signers, sent_by)
      values (${T1}, ${cid}, 'fake', ${`turn-${cid}`}, 'sent',
        ${sql.json([company, partner].sort((a, b) => a.order - b.order) as never)}, ${S})`;
  }
  db = createDb(urls().hubApi, { max: 4 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

const TX_CTL =
  /^\s*((begin|commit|rollback|savepoint|release)\b|select set_config\(|select b\.oid,\s+b\.typarray\s+from pg_catalog\.pg_type)/i;
/** Một lượt quét lúc `now`; trả kết quả + số câu SQL nghiệp vụ (bỏ điều khiển tx / set_config). */
async function pass(now: Date) {
  // biome-ignore lint/suspicious/noExplicitAny: hook debug của pool postgres.js (đếm câu)
  const opts = (db as any).db.$client.options as { debug?: unknown };
  const prev = opts.debug;
  let n = 0;
  opts.debug = (_c: number, q: string) => {
    if (!TX_CTL.test(q)) n += 1;
  };
  try {
    const r = await sweepEsignOnce(
      esignSweepDeps(db, async () => [T1, T2]),
      now,
    );
    return { ...r, queries: n };
  } finally {
    opts.debug = prev;
  }
}
const step0 = async (cid: string) =>
  (
    await sql<
      { st: string; why: string | null }[]
    >`select a.esign_status as st, a.esign_reason as why
    from contracts.approvals a join contracts.contracts c on c.run_id = a.id where c.id = ${cid}`
  )[0];
const bells = async () =>
  sql<{ tenant_id: string; user_id: string; link: string; title: string }[]>`
    select tenant_id::text, user_id::text, link, title from hub.notifications
    where kind = 'contract.esign' and tenant_id = any(${sql.array([T1, T2])}::uuid[]) order by created_at, user_id`;

describe("esign-sweep · vòng nền bước Ký số", () => {
  it("kẹt ⇒ cần quyết; nhắc một lần mỗi chu kỳ; quá hạn chuyển cấp một lần; chuông đúng tenant; số câu cố định", async () => {
    const p1 = await pass(NOW);
    expect(p1).toMatchObject({ stale: 1, reminded: 6, escalated: 0, bells: 7 });
    expect(p1.queries).toBe(4); // mỗi tenant: 1 quét + 1 chuông
    expect(await step0(k[0] as string)).toEqual({ st: "needs_decision", why: "SEND_FAILED" });
    expect((await step0(k[2] as string))?.st).toBe("sending");
    const b1 = await bells();
    expect(b1.filter((b) => b.tenant_id === T2).map((b) => b.user_id)).toEqual([S2]);
    expect(b1.filter((b) => b.tenant_id === T1).map((b) => [b.user_id, b.link])).toEqual(
      expect.arrayContaining([
        [O, `/contracts/${k[0]}`],
        [S, `/contracts/${k[1]}`],
        [S, `/contracts/${k[3]}`],
        [S, `/contracts/${k[8]}`],
      ]),
    );
    // (a) công ty đã ký / (b) chưa tới lượt ⇒ người phụ trách "chờ đối tác", không chuông người ký công ty
    for (const cid of [k[6], k[7]]) {
      const mine = b1.filter((b) => b.link === `/contracts/${cid}`);
      expect(mine.map((b) => [b.user_id, b.title.endsWith("đang chờ đối tác ký")])).toEqual([
        [O, true],
      ]);
    }
    expect(b1.every((b) => (b.user_id === S2 || b.user_id === O2) === (b.tenant_id === T2))).toBe(
      true,
    );

    const p2 = await pass(NOW); // chạy lại cùng mốc ⇒ không gì đổi
    expect(p2).toMatchObject({ stale: 0, reminded: 0, escalated: 0, bells: 0 });
    expect(p2.queries).toBe(2); // mỗi tenant 1 câu quét, lô rỗng ⇒ 0 câu chuông

    const p3 = await pass(at(24)); // chu kỳ nhắc kế (k[1], k[3], k[5]; k[4] tới hạn nhắc đầu); k[2] giờ mới kẹt
    expect(p3).toMatchObject({ stale: 1, reminded: 7, escalated: 0 });

    const p4 = await pass(at(48)); // k[1]/k[3]/k[5] gửi 73 h ⇒ quá hạn + nhắc; k[1] có Group ⇒ trưởng phòng B
    expect(p4).toMatchObject({ reminded: 7, escalated: 6 });
    expect(p4.queries).toBe(5); // T1: quét + danh bạ + chuông; T2: quét + chuông
    const esc = (await bells()).filter((b) => b.title.endsWith("quá hạn"));
    expect(
      esc
        .filter((b) => b.link === `/contracts/${k[1]}`)
        .map((b) => b.user_id)
        .sort(),
    ).toEqual([O, B].sort());
    expect(esc.filter((b) => b.tenant_id === T2).map((b) => b.user_id)).toEqual([O2]);

    const p5 = await pass(at(49)); // đã chuyển cấp + vừa nhắc ⇒ không lặp
    expect(p5).toMatchObject({ stale: 0, reminded: 0, escalated: 0, bells: 0 });
  });
});
