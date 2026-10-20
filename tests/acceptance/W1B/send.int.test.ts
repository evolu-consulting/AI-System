// W1b · gửi hẹn nhắc chung đúng giờ (vòng nền theo khuôn HD4): `createContractFollowupSender` với đồng hồ giả (không sleep). Claim
// SKIP LOCKED theo lô, đổi `sent` + `notify.enqueue` cùng MỘT câu, dedup_key chống nhân đôi, giờ hẹn theo múi tenant, cách ly tenant, role job
// chỉ đọc (tenant_id, due_at, status). Hẹn nhắc gắn HĐ/đối tác dựng bằng owner (bỏ RLS) rồi kiểm qua `hub.notifications`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { FakeClock } from "@ai/test-kit/clock";
import { pgCode } from "@ai/test-kit/db";
import { connectDb } from "../../../apps/hub-api/src/lib/db";
import { createContractFollowupSender } from "../../../apps/hub-api/src/modules/packs/contracts/reminders.mount";
import { HUB_API_URL } from "../H1/_fixtures";
import { inPack } from "../HD1/_support/hd1";
import { arrangeW1, type CtxN1, call, d, myWork, P, priced, startHd1, T } from "../W1/_support/w1";

const VN = "Asia/Ho_Chi_Minh";
let c: CtxN1;
let db: ReturnType<typeof connectDb>;
beforeAll(async () => {
  c = await startHd1();
  db = connectDb(HUB_API_URL, 6);
}, 120_000);
afterAll(async () => {
  await db?.close();
  await c?.stop();
});

/** 10:00 giờ VN của ngày `n` (UTC 03:00). */
const noon = (n: number) => new Date(`${d(n)}T03:00:00Z`);
const sender = (clock: FakeClock, batchSize = 100) =>
  createContractFollowupSender(db, { timeZoneOf: async () => VN, now: clock.now, batchSize });

let seq = 0;
async function followup(o: {
  who?: typeof P.hoa;
  tenant?: string;
  due: string;
  status?: string;
  contract?: string | null;
  note?: string | null;
  title?: string;
}): Promise<string> {
  const [r] = await c.sql<{ id: string }[]>`insert into contracts.followups
      (tenant_id, user_id, subject_kind, subject_id, contract_id, due_at, title, note, status, done_at)
    values (${o.tenant ?? T.acme}, ${(o.who ?? P.hoa).id}, 'company', ${`tax:${++seq}`}, ${o.contract ?? null}, ${o.due},
      ${o.title ?? `Hẹn ${seq}`}, ${o.note ?? null}, ${o.status ?? "pending"}, ${o.status === "done" ? o.due : null})
    returning id::text`;
  return r?.id as string;
}
const notices = (kind = "contract.followup") =>
  c.sql<
    {
      user_id: string;
      tenant_id: string;
      title: string;
      body: string;
      link: string;
      dedup_key: string;
    }[]
  >`
    select user_id::text, tenant_id::text, title, body, link, dedup_key from hub.notifications
    where source = 'contracts' and kind = ${kind} order by created_at, id`;
const statusOf = async (id: string) =>
  (await c.sql<{ status: string }[]>`select status from contracts.followups where id = ${id}`)[0]
    ?.status;

async function fresh() {
  await arrangeW1(c);
  await c.sql`delete from hub.notifications where source = 'contracts'`;
}

describe("W1b · gửi đúng giờ", () => {
  it("tới giờ ⇒ gửi MỘT thông báo cho đúng người: tiêu đề, ghi chú + giờ hẹn theo múi tenant, liên kết HĐ; hàng thành `sent`; vẫn hiện ở Việc của tôi", async () => {
    await fresh();
    const k = await priced(c.sql, { partner: "A", number: "F-1", items: [] });
    const id = await followup({
      due: `${d(0)}T09:00:00+07:00`,
      contract: k,
      title: "Thu Khách An",
      note: "gọi",
    });
    const r = await sender(new FakeClock(noon(0))).once();
    expect(r).toEqual({ tenantId: T.acme, claimed: 1, notified: 1 });
    expect(await statusOf(id)).toBe("sent");
    const [n, ...rest] = await notices();
    expect(rest).toEqual([]);
    expect(n).toMatchObject({
      user_id: P.hoa.id,
      tenant_id: T.acme,
      title: "Thu Khách An",
      link: `/contracts/${k}`,
    });
    expect(n?.body).toBe(`gọi\nĐã hẹn nhắc lúc 09:00 ${d(0).slice(8)}/${d(0).slice(5, 7)}.`);
    expect(n?.dedup_key).toBe(`followup:${id}:${d(0).replaceAll("-", "")}0200`); // UTC
    expect((await myWork(c, P.hoa)).json.items.map((i: { id: string }) => i.id)).toContain(
      `followup:${id}`,
    );
  });
  it("chưa tới giờ / đã xong / đã gửi ⇒ không gửi; không còn việc ⇒ null", async () => {
    await fresh();
    const later = await followup({ due: `${d(0)}T15:00:00+07:00` });
    const done = await followup({ due: `${d(-1)}T09:00:00+07:00`, status: "done" });
    const sent = await followup({ due: `${d(-1)}T09:00:00+07:00`, status: "sent" });
    const s = sender(new FakeClock(noon(0)));
    expect(await s.once()).toBeNull();
    expect([await statusOf(later), await statusOf(done), await statusOf(sent)]).toEqual([
      "pending",
      "done",
      "sent",
    ]);
    expect([...(await notices())]).toEqual([]);
  });
  it("dedup: chạy lại cùng giờ hẹn không nhân đôi; nhắc lại sau sang giờ mới ⇒ gửi lại một thông báo mới", async () => {
    await fresh();
    const id = await followup({ due: `${d(0)}T09:00:00+07:00` });
    const clock = new FakeClock(noon(0));
    const s = sender(clock);
    await s.once();
    await c.sql`update contracts.followups set status = 'pending' where id = ${id}`; // chạy lại cùng giờ hẹn
    expect(await s.once()).toMatchObject({ claimed: 1, notified: 0 });
    expect((await notices()).length).toBe(1);
    const snooze = await call(c, P.hoa, "POST", `/followups/${id}/snooze`, { at: `${d(1)}T09:00` });
    expect(snooze.status).toBe(200);
    clock.set(noon(1));
    expect(await s.once()).toMatchObject({ claimed: 1, notified: 1 });
    expect((await notices()).map((n) => n.dedup_key)).toHaveLength(2);
  });
  it("lô: batchSize 20 trên 50 hẹn nhắc ⇒ 20 / 20 / 10; hai bộ gửi chạy SONG SONG ⇒ mỗi hẹn nhắc đúng một thông báo (SKIP LOCKED)", async () => {
    await fresh();
    for (let i = 0; i < 50; i++)
      await followup({ due: `${d(-1)}T09:00:00+07:00`, who: i % 2 ? P.hoa : P.lan });
    const solo = await sender(new FakeClock(noon(0)), 20).once();
    expect(solo).toMatchObject({ claimed: 20, notified: 20 });
    const [a, b] = await Promise.all([
      sender(new FakeClock(noon(0)), 20).drain(),
      sender(new FakeClock(noon(0)), 20).drain(),
    ]);
    expect(a.claimed + b.claimed).toBe(30);
    expect(a.failed + b.failed).toBe(0);
    const all = await notices();
    expect(all).toHaveLength(50);
    expect(new Set(all.map((n) => n.dedup_key)).size).toBe(50);
    expect(
      (
        await c.sql<
          { n: number }[]
        >`select count(*)::int as n from contracts.followups where status = 'pending'`
      )[0]?.n,
    ).toBe(0);
  });
  it("hàng đang bị giao dịch khác khoá ⇒ bỏ qua lượt này (SKIP LOCKED), các hàng còn lại vẫn gửi; mở khoá ⇒ lượt sau gửi", async () => {
    await fresh();
    const locked = await followup({ due: `${d(-1)}T09:00:00+07:00` });
    const free = await followup({ due: `${d(-1)}T09:00:00+07:00` });
    const s = sender(new FakeClock(noon(0)));
    await c.sql.begin(async (tx) => {
      await tx`select 1 from contracts.followups where id = ${locked} for update`;
      expect(await s.once()).toMatchObject({ claimed: 1, notified: 1 });
    });
    expect([await statusOf(locked), await statusOf(free)]).toEqual(["pending", "sent"]);
    expect(await s.once()).toMatchObject({ claimed: 1, notified: 1 });
    expect(await s.once()).toBeNull();
  });
  it("nhiều tenant: mỗi tenant một lô, thông báo đúng tenant; drain hết cả hai", async () => {
    await fresh();
    await followup({ due: `${d(-1)}T09:00:00+07:00` });
    await followup({ due: `${d(-1)}T09:00:00+07:00`, tenant: T.beta, who: P.an });
    const t = await sender(new FakeClock(noon(0))).drain();
    expect(t).toMatchObject({ batches: 2, claimed: 2, notified: 2, failed: 0 });
    const got = await notices();
    expect(got.map((n) => [n.tenant_id, n.user_id]).sort()).toEqual(
      [
        [T.acme, P.hoa.id],
        [T.beta, P.an.id],
      ].sort(),
    );
  });
  it("người nhận ngoài tenant bị bỏ qua (không lọt thông báo); hẹn nhắc vẫn thành `sent`", async () => {
    await fresh();
    const id = await followup({ due: `${d(-1)}T09:00:00+07:00`, who: P.an }); // an thuộc beta, hẹn nhắc lại ở acme
    expect(await sender(new FakeClock(noon(0))).once()).toMatchObject({ claimed: 1, notified: 0 });
    expect(await statusOf(id)).toBe("sent");
    expect([...(await notices())]).toEqual([]);
  });
  it("role job chỉ đọc (tenant_id, due_at, status) của hàng chờ: đọc tiêu đề ⇒ 42501, không ghi được", async () => {
    await fresh();
    await followup({ due: `${d(0)}T09:00:00+07:00` });
    const run = (q: string) => pgCode(() => inPack(T.acme, (tx) => tx.unsafe(q), "contracts_job"));
    expect(await run("select title from contracts.followups")).toBe("42501");
    expect(await run("select user_id from contracts.followups")).toBe("42501");
    expect(await run("update contracts.followups set status = 'done'")).toBe("42501");
    expect(await run("select tenant_id, due_at, status from contracts.followups")).toBeNull();
    const n = await inPack(
      T.acme,
      async (tx) =>
        (
          (await tx.unsafe("select count(*)::int as n from contracts.followups")) as unknown as {
            n: number;
          }[]
        )[0]?.n,
      "contracts_job",
    );
    expect(n).toBe(1);
  });
});
