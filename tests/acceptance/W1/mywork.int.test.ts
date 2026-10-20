// W1 · "Việc của tôi" (`GET /pack/contracts/my-work`, `POST /my-work/followups/:id/{done,snooze}`): nguồn dữ liệu (đợt HD7, hạn HD4, nhắc
// hạn HD4, hẹn nhắc HD9), luật thấy M1 (chế độ org: không có việc của HĐ mình không thấy), hẹn nhắc CHỈ của chính mình, quyền gói,
// cách ly tenant, đầu vào xấu không bao giờ 5xx, số câu SQL cố định. Ngày tương đối theo múi tenant (Asia/Ho_Chi_Minh).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { inPackAs, pgCode } from "@ai/test-kit/db";
import {
  addFollowup,
  addObligation,
  arrangeW1,
  type CtxN1,
  call,
  captureSql,
  d,
  ids,
  myWork,
  P,
  priced,
  setVisibility,
  startHd1,
  T,
} from "./_support/w1";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

/** Mốc "+07:00" của ngày n lúc `hh:mm`. */
const at = (n: number, hh = "09:00") => `${d(n)}T${hh}:00+07:00`;

async function world() {
  await arrangeW1(c);
  const sale = await priced(c.sql, {
    sale: true,
    partner: "Khách An",
    number: "S-1",
    items: [],
    owner: P.hoa.id,
  });
  const buy = await priced(c.sql, {
    partner: "NCC Bình",
    number: "M-1",
    items: [],
    owner: P.lan.id,
  });
  const o = {
    late: await addObligation(c.sql, sale, { due: d(-3), direction: "receive", amount: 5_000_000 }),
    today: await addObligation(c.sql, buy, { due: d(0), direction: "pay", seq: 1 }),
    soon: await addObligation(c.sql, buy, { due: d(5), direction: "pay", seq: 2 }),
    far: await addObligation(c.sql, buy, { due: d(30), direction: "pay", seq: 3 }),
    done: await addObligation(c.sql, buy, { due: d(-1), status: "done", seq: 4 }),
    delivery: await addObligation(c.sql, buy, { due: d(-1), kind: "delivery", seq: 5 }),
  };
  return { sale, buy, o };
}

describe("W1 · nguồn dữ liệu", () => {
  it("đợt: mở + tiền, tới hạn ≤ 7 ngày (kể cả trễ); đã xong / giao hàng / xa hơn 7 ngày không có mặt", async () => {
    const { o } = await world();
    const r = await myWork(c, P.lan);
    expect(r.status).toBe(200);
    expect(ids(r)).toEqual([
      `obligation:${o.late}`,
      `obligation:${o.today}`,
      `obligation:${o.soon}`,
    ]); // trễ → hôm nay → sắp tới
    const late = r.json.items.find((i: { id: string }) => i.id === `obligation:${o.late}`);
    expect(late).toMatchObject({
      kind: "obligation",
      tone: "late",
      days: 3,
      direction: "receive",
      amount: 5_000_000,
      party: "Khách An",
      title: "S-1",
      contract_direction: "sale",
    });
    expect(r.json.counts).toEqual({ late: 1, today: 1, upcoming: 1 });
    expect(r.json.truncated).toBe(false);
  });
  it("hạn xử lý HĐ (HD4): HĐ chưa ghi kết quả có hạn ≤ 7 ngày; đã ghi kết quả, chờ kiểm, hạn xa, hết hạn quá 60 ngày thì không", async () => {
    await arrangeW1(c);
    const near = await priced(c.sql, { partner: "A", number: "D-1", items: [], end: d(2) });
    await priced(c.sql, {
      partner: "B",
      number: "D-2",
      items: [],
      end: d(2),
      handled: { outcome: "renewed" },
    });
    await priced(c.sql, { partner: "C", number: "D-3", items: [], end: d(40) });
    await priced(c.sql, {
      partner: "D",
      number: "D-4",
      items: [],
      end: d(2),
      status: "needs_review",
    });
    await priced(c.sql, { partner: "E", number: "D-5", items: [], end: d(-80), status: "expired" });
    const lateOne = await priced(c.sql, {
      partner: "F",
      number: "D-6",
      items: [],
      end: d(-10),
      status: "expired",
    });
    const r = await myWork(c, P.hoa);
    expect(ids(r).sort()).toEqual([`deadline:${near}`, `deadline:${lateOne}`].sort());
    expect(r.json.items.find((i: { id: string }) => i.id === `deadline:${lateOne}`)).toMatchObject({
      tone: "late",
      days: 10,
      contract_id: lateOne,
      contract_direction: "purchase",
    });
  });
  it("nhắc hạn đã gửi cho MÌNH (HD4): hạn xa hơn 7 ngày, chưa xử lý, mốc mới nhất mỗi HĐ; của người khác không thấy", async () => {
    await arrangeW1(c);
    const k = await priced(c.sql, { partner: "A", number: "R-1", items: [], end: d(20) });
    const done = await priced(c.sql, {
      partner: "B",
      number: "R-2",
      items: [],
      end: d(20),
      handled: { outcome: "renewed" },
    });
    for (const [cid, ms] of [
      [k, 30],
      [k, 14],
      [done, 30],
    ] as const)
      await c.sql`insert into contracts.contract_reminders (tenant_id, contract_id, deadline, milestone, user_id, channel)
        values (${T.acme}, ${cid}, ${d(20)}, ${ms}, ${P.hoa.id}, 'email')`;
    const mine = await myWork(c, P.hoa);
    expect(ids(mine)).toEqual([`reminder:${await reminderId(k, 14)}`]);
    expect(mine.json.items[0]).toMatchObject({
      kind: "reminder",
      tone: "dim",
      milestone: 14,
      days: -20,
      contract_id: k,
    });
    expect(ids(await myWork(c, P.lan))).toEqual([]);
  });
  it("hẹn nhắc (HD9): chỉ của mình, chưa xong, ≤ 7 ngày; mang ngày + giờ địa phương, tên khách, ghi chú", async () => {
    await arrangeW1(c);
    const mine = await addFollowup(c.sql, P.hoa, {
      at: at(0, "08:30"),
      name: "Bếp Việt",
      note: "Gọi lại",
    });
    await addFollowup(c.sql, P.hoa, { at: at(0, "08:00"), done: true });
    await addFollowup(c.sql, P.hoa, { at: at(20) });
    await addFollowup(c.sql, P.lan, { at: at(0) });
    const r = await myWork(c, P.hoa);
    expect(ids(r)).toEqual([`followup:${mine}`]);
    expect(r.json.items[0]).toMatchObject({
      kind: "followup",
      tone: "soon",
      days: 0,
      at: `${d(0)}T08:30`,
      title: "Bếp Việt",
      note: "Gọi lại",
      subject: "customer",
    });
    // trễ: hẹn hôm qua
    const old = await addFollowup(c.sql, P.hoa, { at: at(-1, "17:00") });
    expect(ids(await myWork(c, P.hoa))[0]).toBe(`followup:${old}`);
  });
});

async function reminderId(contract: string, milestone: number): Promise<string> {
  const [r] = await c.sql<{ id: string }[]>`select id::text from contracts.contract_reminders
    where contract_id = ${contract} and milestone = ${milestone}`;
  return r?.id as string;
}

describe("W1 · luật thấy M1 (chế độ org)", () => {
  it("hoa chỉ thấy việc của HĐ mình phụ trách; lan (owner gói) thấy cả tenant; chế độ tenant ⇒ ai cũng thấy hết", async () => {
    const { o } = await world();
    await setVisibility(c, "org");
    try {
      expect(ids(await myWork(c, P.hoa))).toEqual([`obligation:${o.late}`]); // HĐ bán S-1 của hoa
      expect(ids(await myWork(c, P.lan))).toHaveLength(3);
      expect(ids(await myWork(c, P.tam))).toEqual([]); // viewer không phụ trách HĐ nào
    } finally {
      await setVisibility(c, "tenant");
    }
    expect(ids(await myWork(c, P.hoa))).toHaveLength(3);
    expect(ids(await myWork(c, P.tam))).toHaveLength(3);
  });
  it("hạn xử lý + nhắc hạn của HĐ không thấy bị ẩn; hẹn nhắc của mình vẫn thuộc mình", async () => {
    await arrangeW1(c);
    const mineC = await priced(c.sql, {
      partner: "A",
      number: "V-1",
      items: [],
      end: d(2),
      owner: P.hoa.id,
    });
    await priced(c.sql, { partner: "B", number: "V-2", items: [], end: d(2), owner: P.lan.id });
    const f = await addFollowup(c.sql, P.hoa, { at: at(0) });
    await setVisibility(c, "org");
    try {
      expect(ids(await myWork(c, P.hoa)).sort()).toEqual(
        [`deadline:${mineC}`, `followup:${f}`].sort(),
      );
      expect(ids(await myWork(c, P.lan)).filter((x) => x.startsWith("deadline:"))).toHaveLength(2);
    } finally {
      await setVisibility(c, "tenant");
    }
  });
  it("hẹn nhắc gia hạn của HĐ mình không thấy (renewal bị RLS) ⇒ không hiện; hẹn nhắc khách thì hiện", async () => {
    await arrangeW1(c);
    const hidden = await priced(c.sql, { partner: "X", number: "H-1", items: [], owner: P.lan.id });
    const [cu] = await c.sql<
      { id: string }[]
    >`insert into contracts.cks_customers (tenant_id, name) values (${T.acme}, 'Khách H') returning id::text`;
    const [rn] = await c.sql<
      { id: string }[]
    >`insert into contracts.cks_renewals (tenant_id, sale_contract_id, customer_id,
        certificate_ids, new_contract_id, price_each, valid_to, created_by)
      values (${T.acme}, ${hidden}, ${cu?.id as string}, array[${hidden}]::uuid[], ${hidden}, 1, '2027-01-01', ${P.lan.id}) returning id::text`;
    await c.sql`insert into contracts.cks_followups (tenant_id, user_id, renewal_id, due_at)
      values (${T.acme}, ${P.hoa.id}, ${rn?.id as string}, now())`;
    const visible = await addFollowup(c.sql, P.hoa, { at: at(0) });
    await setVisibility(c, "org");
    try {
      expect(ids(await myWork(c, P.hoa))).toEqual([`followup:${visible}`]);
    } finally {
      await setVisibility(c, "tenant");
    }
    expect(ids(await myWork(c, P.hoa))).toHaveLength(2);
  });
});

describe("W1 · xong / nhắc lại sau (chỉ hẹn nhắc của chính mình)", () => {
  it("xong: biến khỏi danh sách; làm lại vô hại; hẹn nhắc của người khác ⇒ 404 và không đổi", async () => {
    await arrangeW1(c);
    const mine = await addFollowup(c.sql, P.hoa, { at: at(0) });
    const theirs = await addFollowup(c.sql, P.lan, { at: at(0) });
    const x = await call(c, P.hoa, "POST", `/my-work/followups/${theirs}/done`, {});
    expect(x.status).toBe(404);
    const [t] = await c.sql<
      { done: boolean }[]
    >`select done_at is not null as done from contracts.cks_followups where id = ${theirs}`;
    expect(t?.done).toBe(false);
    for (let i = 0; i < 2; i++) {
      const r = await call(c, P.hoa, "POST", `/my-work/followups/${mine}/done`, {});
      expect([r.status, r.json]).toEqual([200, { ok: true }]);
    }
    expect(ids(await myWork(c, P.hoa))).toEqual([]);
    expect(ids(await myWork(c, P.lan))).toEqual([`followup:${theirs}`]);
  });
  it("nhắc lại sau: dời tới giờ địa phương mới (múi tenant); dời ra xa ⇒ rời danh sách; mở lại hẹn đã xong", async () => {
    await arrangeW1(c);
    const f = await addFollowup(c.sql, P.hoa, { at: at(0), done: true });
    const r = await call(c, P.hoa, "POST", `/my-work/followups/${f}/snooze`, {
      at: `${d(1)}T09:15`,
    });
    expect(r.status).toBe(200);
    const got = await myWork(c, P.hoa);
    expect(got.json.items[0]).toMatchObject({
      id: `followup:${f}`,
      at: `${d(1)}T09:15`,
      days: -1,
      tone: "dim",
    });
    await call(c, P.hoa, "POST", `/my-work/followups/${f}/snooze`, { at: `${d(30)}T09:00` });
    expect(ids(await myWork(c, P.hoa))).toEqual([]);
    expect(
      (await call(c, P.lan, "POST", `/my-work/followups/${f}/snooze`, { at: `${d(1)}T09:00` }))
        .status,
    ).toBe(404);
  });
  it("viewer cũng đóng được hẹn nhắc của mình (như mgmt-app: hẹn nhắc là của riêng người dùng)", async () => {
    await arrangeW1(c);
    const f = await addFollowup(c.sql, P.tam, { at: at(0) });
    expect((await call(c, P.tam, "POST", `/my-work/followups/${f}/done`, {})).status).toBe(200);
  });
});

describe("W1 · quyền gói, tenant, đầu vào xấu", () => {
  it("không Group ⇒ 403 cả đọc lẫn ghi; chưa đăng nhập ⇒ 401", async () => {
    await arrangeW1(c);
    expect((await myWork(c, P.cuc)).status).toBe(403);
    expect(
      (await call(c, P.cuc, "POST", `/my-work/followups/${crypto.randomUUID()}/done`, {})).status,
    ).toBe(403);
    const anon = await fetch(`${c.hub.base}${BASE_PATH}/my-work`);
    expect(anon.status).toBe(401);
  });
  it("beta (tenant khác) thấy rỗng; đóng/dời hẹn nhắc của acme ⇒ 404, không đổi gì", async () => {
    await arrangeW1(c);
    await world();
    const f = await addFollowup(c.sql, P.hoa, { at: at(0) });
    const r = await myWork(c, P.an);
    expect([r.status, r.json.items]).toEqual([200, []]);
    expect((await call(c, P.an, "POST", `/my-work/followups/${f}/done`, {})).status).toBe(404);
    expect(
      (await call(c, P.an, "POST", `/my-work/followups/${f}/snooze`, { at: `${d(1)}T09:00` }))
        .status,
    ).toBe(404);
    const [t] = await c.sql<
      { done: boolean }[]
    >`select done_at is not null as done from contracts.cks_followups where id = ${f}`;
    expect(t?.done).toBe(false);
  });
  it("đầu vào xấu ⇒ 4xx rõ, KHÔNG BAO GIỜ 5xx: query lạ, id sai dạng, thân lạ/hỏng, giờ không có thật, tenant_id trong thân", async () => {
    await arrangeW1(c);
    const f = await addFollowup(c.sql, P.hoa, { at: at(0) });
    const bad: [string, string, unknown, number][] = [
      ["GET", "/my-work?x=1", undefined, 400],
      ["GET", "/my-work?limit=-1", undefined, 400],
      ["POST", "/my-work/followups/not-a-uuid/done", {}, 400],
      ["POST", `/my-work/followups/${f}/done`, { tenant_id: T.beta }, 400],
      ["POST", `/my-work/followups/${f}/snooze`, {}, 400],
      ["POST", `/my-work/followups/${f}/snooze`, { at: "2026-02-30T10:00" }, 400],
      ["POST", `/my-work/followups/${f}/snooze`, { at: "2026-10-20T25:00" }, 400],
      ["POST", `/my-work/followups/${f}/snooze`, { at: "2026-10-20" }, 400],
      ["POST", `/my-work/followups/${f}/snooze`, { at: 20261020 }, 400],
      ["POST", `/my-work/followups/${f}/snooze`, { at: `${d(1)}T09:00`, user_id: P.lan.id }, 400],
      ["POST", `/my-work/followups/${f}/snooze`, { at: "0000-01-01T00:00" }, 400],
    ];
    for (const [m, path, body, want] of bad) {
      const r = await call(c, P.hoa, m, path, body);
      expect({ m, path, body, status: r.status }).toEqual({ m, path, body, status: want });
    }
    const raw = await fetch(`${c.hub.base}${BASE_PATH}/my-work/followups/${f}/snooze`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await c.tok(P.hoa)}`,
        "content-type": "application/json",
      },
      body: "{không phải json",
    });
    expect(raw.status).toBe(400);
  });
});

const BASE_PATH = "/pack/contracts";

describe("W1-NFR · số câu SQL cố định", () => {
  it("GET /my-work: câu đặt phạm vi tx + đúng 1 câu nghiệp vụ dù có 0 hay nhiều hàng ở cả bốn nguồn", async () => {
    await arrangeW1(c);
    await myWork(c, P.hoa); // làm nóng bộ nhớ quyền gói (0 SQL ở các lượt sau)
    const empty = await captureSql(c, () => myWork(c, P.hoa));
    await world();
    for (let i = 0; i < 30; i++) {
      const k = await priced(c.sql, {
        partner: `P${i}`,
        number: `B-${i}`,
        items: [],
        end: d(1 + (i % 5)),
      });
      await addObligation(c.sql, k, { due: d(-(i % 9)), direction: i % 2 ? "pay" : "receive" });
      await addFollowup(c.sql, P.hoa, { at: at(i % 3) });
    }
    const full = await captureSql(c, () => myWork(c, P.hoa));
    expect([empty.r.status, full.r.status]).toEqual([200, 200]);
    expect(full.r.json.items.length).toBeGreaterThan(60);
    expect([empty.queries.length, full.queries.length]).toEqual([2, 2]);
  });
});

describe("W1 · hẹn nhắc chung (GET/POST /followups)", () => {
  const mk = (p: typeof P.hoa, body: unknown) => call(c, p, "POST", "/followups", body);
  const when = (n: number, hh = "09:00") => `${d(n)}T${hh}`;

  it("đặt về đợt: tiêu đề do máy chủ đặt, hiện ở Việc của tôi và GET /followups; đặt lại ⇒ dời (một hẹn nhắc mở mỗi chủ thể)", async () => {
    await arrangeW1(c);
    const w = await priced(c.sql, {
      sale: true,
      partner: "Khách An",
      tax: "0400000001",
      number: "G-1",
      items: [],
    });
    const ob = await addObligation(c.sql, w, {
      due: d(5),
      direction: "receive",
      amount: 5_000_000,
    });
    const r1 = await mk(P.hoa, {
      subject_kind: "obligation",
      subject_id: ob,
      at: when(0),
      note: "gọi",
    });
    expect(r1.status).toBe(201);
    const r2 = await mk(P.hoa, { subject_kind: "obligation", subject_id: ob, at: when(-1) });
    expect(r2.json.id).toBe(r1.json.id);
    const list = await call(c, P.hoa, "GET", "/followups");
    expect(list.json).toEqual([
      expect.objectContaining({
        id: r1.json.id,
        subject_kind: "obligation",
        subject_id: ob,
        contract_id: w,
        at: when(-1),
        title: "Thu Khách An 5.000.000 đ",
        note: null,
        status: "pending",
      }),
    ]);
    const mine = await myWork(c, P.hoa);
    expect(
      mine.json.items.find((i: { id: string }) => i.id === `followup:${r1.json.id}`),
    ).toMatchObject({
      kind: "followup",
      subject: "obligation",
      title: "Thu Khách An 5.000.000 đ",
      contract_id: w,
      tone: "late",
    });
    expect(ids(await myWork(c, P.lan)).includes(`followup:${r1.json.id}`)).toBe(false); // của riêng người đặt
    expect((await call(c, P.lan, "GET", "/followups")).json).toEqual([]);
  });
  it("đợt đã xong ⇒ hẹn nhắc về nó rời Việc của tôi; xong / nhắc lại sau (cả hai đường) chỉ của mình", async () => {
    await arrangeW1(c);
    const w = await priced(c.sql, { sale: true, partner: "Khách B", number: "G-2", items: [] });
    const ob = await addObligation(c.sql, w, { due: d(2), direction: "receive" });
    const id = (await mk(P.hoa, { subject_kind: "obligation", subject_id: ob, at: when(0) })).json
      .id;
    expect(ids(await myWork(c, P.hoa))).toContain(`followup:${id}`);
    await c.sql`update contracts.obligations set status = 'done', done_at = ${d(0)} where id = ${ob}`;
    expect(ids(await myWork(c, P.hoa))).not.toContain(`followup:${id}`);
    await c.sql`update contracts.obligations set status = 'open', done_at = null where id = ${ob}`;
    expect((await call(c, P.lan, "POST", `/followups/${id}/done`, {})).status).toBe(404);
    expect((await call(c, P.hoa, "POST", `/followups/${id}/snooze`, { at: when(30) })).status).toBe(
      200,
    );
    expect(ids(await myWork(c, P.hoa))).not.toContain(`followup:${id}`);
    expect((await call(c, P.hoa, "POST", `/my-work/followups/${id}/done`, {})).status).toBe(200);
    expect((await call(c, P.hoa, "GET", "/followups")).json).toEqual([]);
    // làm xong rồi đặt lại ⇒ hẹn nhắc mở mới
    const again = await mk(P.hoa, { subject_kind: "obligation", subject_id: ob, at: when(0) });
    expect([again.status, again.json.id === id]).toEqual([201, false]);
  });
  it("về HĐ và đối tác: chủ thể phải có và NGƯỜI DÙNG THẤY; lạ / không thấy ⇒ 404 và không ghi gì", async () => {
    await arrangeW1(c);
    const mineC = await priced(c.sql, {
      partner: "NCC Một",
      tax: "0300000001",
      number: "G-3",
      items: [],
      owner: P.hoa.id,
    });
    const otherC = await priced(c.sql, {
      partner: "NCC Hai",
      tax: "0300000002",
      number: "G-4",
      items: [],
      owner: P.lan.id,
    });
    await setVisibility(c, "org");
    try {
      expect(
        (await mk(P.hoa, { subject_kind: "contract", subject_id: mineC, at: when(1) })).status,
      ).toBe(201);
      expect(
        (await mk(P.hoa, { subject_kind: "company", subject_id: "tax:0300000001", at: when(1) }))
          .status,
      ).toBe(201);
      const hidden: [string, string][] = [
        ["contract", otherC],
        ["company", "tax:0300000002"],
        ["company", "tax:9999999999"],
        ["contract", crypto.randomUUID()],
        ["obligation", crypto.randomUUID()],
        ["renewal", crypto.randomUUID()],
        ["contract", "không-phải-uuid"],
        ["obligation", mineC], // đúng uuid nhưng sai loại chủ thể
      ];
      for (const [k, s] of hidden) {
        const r = await mk(P.hoa, { subject_kind: k, subject_id: s, at: when(1) });
        expect({ k, s, status: r.status }).toEqual({ k, s, status: 404 });
      }
      expect(
        (await mk(P.lan, { subject_kind: "contract", subject_id: otherC, at: when(1) })).status,
      ).toBe(201); // owner gói thấy hết
    } finally {
      await setVisibility(c, "tenant");
    }
    expect(
      (await c.sql<{ n: number }[]>`select count(*)::int as n from contracts.followups`)[0]?.n,
    ).toBe(3);
    const titles = (await call(c, P.hoa, "GET", "/followups")).json.map(
      (f: { title: string }) => f.title,
    );
    expect(titles.sort()).toEqual(["G-3", "NCC Một"]);
  });
  it("người xem đặt được cho cái mình thấy; tenant khác ⇒ 404; không Group ⇒ 403", async () => {
    await arrangeW1(c);
    const k = await priced(c.sql, { partner: "A", number: "G-5", items: [] });
    expect((await mk(P.tam, { subject_kind: "contract", subject_id: k, at: when(1) })).status).toBe(
      201,
    );
    expect((await mk(P.an, { subject_kind: "contract", subject_id: k, at: when(1) })).status).toBe(
      404,
    );
    expect((await mk(P.cuc, { subject_kind: "contract", subject_id: k, at: when(1) })).status).toBe(
      403,
    );
  });
  it("đầu vào xấu ⇒ 4xx, không bao giờ 5xx; RLS: role gói không xoá được, không đặt hộ người khác", async () => {
    await arrangeW1(c);
    const k = await priced(c.sql, { partner: "A", number: "G-6", items: [] });
    const ok = { subject_kind: "contract", subject_id: k, at: when(1) };
    const bad: [string, unknown][] = [
      ["POST", { ...ok, subject_kind: "nope" }],
      ["POST", { ...ok, subject_id: "" }],
      ["POST", { ...ok, subject_id: "x".repeat(301) }],
      ["POST", { ...ok, at: "2026-02-30T10:00" }],
      ["POST", { ...ok, at: "2026-10-20" }],
      ["POST", { ...ok, note: "n".repeat(201) }],
      ["POST", { ...ok, user_id: P.lan.id }],
      ["POST", { ...ok, tenant_id: T.beta }],
      ["POST", { ...ok, subject_id: 5 }],
      ["POST", {}],
    ];
    for (const [m, body] of bad) {
      const r = await call(c, P.hoa, m, "/followups", body);
      expect({ body, status: r.status }).toEqual({ body, status: 400 });
    }
    expect((await call(c, P.hoa, "GET", "/followups?x=1")).status).toBe(400);
    expect((await call(c, P.hoa, "GET", `/followups?subject_id=${"y".repeat(301)}`)).status).toBe(
      400,
    );
    expect((await call(c, P.hoa, "POST", "/followups/not-a-uuid/done", {})).status).toBe(400);
    const raw = await fetch(`${c.hub.base}/pack/contracts/followups`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await c.tok(P.hoa)}`,
        "content-type": "application/json",
      },
      body: "{x",
    });
    expect(raw.status).toBe(400);
    await mk(P.hoa, ok);
    // V2-M: contracts_rw lấy lại DELETE trên followups, nhưng chỉ khi tx có cờ v2m_del của HĐ gắn
    // ⇒ xoá trần không lỗi nhưng 0 hàng, hẹn nhắc còn nguyên.
    const countF = async () =>
      Number((await c.sql`select count(*)::int as n from contracts.followups`)[0]?.n);
    const before = await countF();
    expect(before).toBeGreaterThan(0);
    const code = await pgCode(() =>
      inPackAs("contracts", T.acme, P.hoa.id, (tx) => tx.unsafe("delete from contracts.followups")),
    );
    expect(code).toBeNull();
    expect(await countF()).toBe(before);
  });
  it("review B #8/#15/#16: tiêu đề cắt về 200 (trần thông báo); nhắc lại hẹn đã xong khi đã có hẹn mở cùng chủ thể ⇒ 404 không 5xx; NUL trong subject_id ⇒ 400", async () => {
    await arrangeW1(c);
    const k = await priced(c.sql, { partner: "A", number: "G-8", items: [] });
    await c.sql`update contracts.contracts
      set fields = jsonb_set(fields, '{title}', jsonb_build_object('value', repeat('T', 250))) where id = ${k}`;
    const first = await mk(P.hoa, { subject_kind: "contract", subject_id: k, at: when(1) });
    expect(first.status).toBe(201);
    const [f] = (await call(c, P.hoa, "GET", "/followups")).json as { title: string }[];
    expect(f?.title).toBe("T".repeat(200));
    expect((await call(c, P.hoa, "POST", `/followups/${first.json.id}/done`, {})).status).toBe(200);
    const open = await mk(P.hoa, { subject_kind: "contract", subject_id: k, at: when(2) });
    expect([open.status, open.json.id === first.json.id]).toEqual([201, false]);
    for (const path of [
      `/followups/${first.json.id}/snooze`,
      `/my-work/followups/${first.json.id}/snooze`,
    ]) {
      const r = await call(c, P.hoa, "POST", path, { at: when(3) });
      expect({ path, status: r.status }).toEqual({ path, status: 404 });
    }
    for (const subject_id of ["a\u0000b", "\u0000"]) {
      const r = await mk(P.hoa, { subject_kind: "company", subject_id, at: when(1) });
      expect({ subject_id, status: r.status }).toEqual({ subject_id, status: 400 });
    }
    expect((await call(c, P.hoa, "GET", "/followups?subject_id=a%00b")).status).toBe(400);
  });
  it("số câu SQL cố định: đặt = phạm vi tx + 1; liệt kê = phạm vi tx + 1", async () => {
    await arrangeW1(c);
    const k = await priced(c.sql, { partner: "A", number: "G-7", items: [] });
    await call(c, P.hoa, "GET", "/followups");
    const a = await captureSql(c, () =>
      mk(P.hoa, { subject_kind: "contract", subject_id: k, at: when(1) }),
    );
    const b = await captureSql(c, () => call(c, P.hoa, "GET", "/followups"));
    expect([a.r.status, a.queries.length, b.r.status, b.queries.length]).toEqual([201, 2, 200, 2]);
  });
});
