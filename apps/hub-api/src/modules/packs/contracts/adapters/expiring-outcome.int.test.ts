// CR-127 K6 · BR-07/08/67/68 · spec §7: kết cục `contract.expiring` (renew / terminate / let_expire) + HĐ gia hạn vào DONE ⇒ HĐ cũ "Đã gia hạn";
// vòng hiệu lực hằng ngày theo lô (`createContractReminders`, ngày theo múi công ty). DB thật, role gói `contracts_rw` + RLS.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { sql } from "drizzle-orm";
import { connectDb, type Db } from "../../../../lib/db";
import { createPackUow } from "../../kit/adapters/pack-uow";
import { createContractReminders } from "../reminders.mount";
import { applyExpiringOutcome, ensureUser, renewalDoneHook } from "./expiring-outcome.repo";

let o: Sql;
let db: Db;
let T = "";
let U = "";
const uow = () => createPackUow(db, "contracts", (tx) => ({ tx }));
const who = () => ({ tenantId: T, userId: U });
const run = <R>(
  fn: (tx: Parameters<Parameters<ReturnType<typeof uow>["tenant"]>[1]>[0]["tx"]) => Promise<R>,
) => uow().tenant(who(), (r) => fn(r.tx));

async function done(extra: Record<string, unknown> = {}, end = "2027-06-30"): Promise<string> {
  const [r] = await o<{ id: string }[]>`insert into contracts.contracts ${o({
    tenant_id: T,
    title: "HĐ thử K6",
    created_by: U,
    owner_user_id: U,
    status: "done",
    fields: { end_date: { value: end } },
    ...extra,
  } as never)} returning id`;
  return (r as { id: string }).id;
}
const row = async (id: string) =>
  (
    await o<
      {
        effect: string | null;
        effect_outcome: string | null;
        effect_evidence_id: string | null;
        status: string;
        file_id: string | null;
        extract_state: string;
        renews_id: string | null;
      }[]
    >`select effect, effect_outcome, effect_evidence_id, status, file_id, extract_state, renews_id from contracts.contracts where id = ${id}`
  )[0];

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  [T] = (await tenants(o, 1, 9196)) as [string];
  [U] = (await users(o, T, 1, { from: 9196 })) as [string];
}, 120_000);

afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-127 K6 · kết cục contract.expiring", () => {
  it("terminate ⇒ Đã chấm dứt + bằng chứng; gọi lại ⇒ already_applied", async () => {
    const id = await done();
    const a = await run((tx) =>
      applyExpiringOutcome(tx, T, { ref: id, actorId: U, outcome: "terminate" }),
    );
    const b = await run((tx) =>
      applyExpiringOutcome(tx, T, { ref: id, actorId: null, outcome: "terminate" }),
    );
    expect([a, b]).toEqual(["applied", "already_applied"]);
    const r = await row(id);
    expect([r?.effect, r?.effect_outcome]).toEqual(["terminated", "terminated"]);
    expect(r?.effect_evidence_id).not.toBeNull();
  });

  it("let_expire ⇒ không đổi gì; HĐ đã bị thay / không DONE ⇒ not_found", async () => {
    const id = await done();
    expect(
      await run((tx) =>
        applyExpiringOutcome(tx, T, { ref: id, actorId: U, outcome: "let_expire" }),
      ),
    ).toBe("applied");
    expect((await row(id))?.effect_outcome).toBeNull();
    // bản bị thay hợp lệ (contracts_version_no_ck): v2 trỏ supersedes/root về v1, v1 ghi superseded_at/by.
    const sup = await done();
    const v2 = await done({ version_no: 2, supersedes_id: sup, root_id: sup });
    await o`update contracts.contracts set superseded_at = now(), superseded_by = ${v2} where id = ${sup}`;
    const dr = await done({ status: "draft" });
    for (const ref of [sup, dr, crypto.randomUUID()])
      expect(
        await run((tx) => applyExpiringOutcome(tx, T, { ref, actorId: U, outcome: "renew" })),
      ).toBe("not_found");
  });

  it("renew ⇒ HĐ gia hạn DRAFT (renews_id, chưa tệp, extract ready); HĐ mới done ⇒ HĐ cũ Đã gia hạn", async () => {
    const id = await done();
    const a = await run((tx) =>
      applyExpiringOutcome(tx, T, { ref: id, actorId: U, outcome: "renew" }),
    );
    const again = await run((tx) =>
      applyExpiringOutcome(tx, T, { ref: id, actorId: U, outcome: "renew" }),
    );
    expect([a, again]).toEqual(["applied", "already_applied"]);
    const kids = await o<
      { id: string }[]
    >`select id from contracts.contracts where renews_id = ${id}`;
    expect(kids.length).toBe(1);
    const kid = await row((kids[0] as { id: string }).id);
    expect([kid?.status, kid?.extract_state, kid?.file_id, kid?.renews_id]).toEqual([
      "draft",
      "ready",
      null,
      id,
    ]);
    expect((await row(id))?.effect_outcome).toBeNull(); // chưa done ⇒ cũ chưa đổi
    await run((tx) => renewalDoneHook.onDone(tx, T, (kids[0] as { id: string }).id));
    const old = await row(id);
    expect([old?.effect, old?.effect_outcome]).toEqual(["renewed", "renewed"]);
    expect(old?.effect_evidence_id).not.toBeNull();
    await run((tx) => renewalDoneHook.onDone(tx, T, (kids[0] as { id: string }).id)); // lặp ⇒ không ném
  });
});

describe("CR-127 K6 · soát Opus (outbox, nháp huỷ, bản hiện hành, người thao tác)", () => {
  const outbox = async (id: string) =>
    (
      await o<
        { n: number }[]
      >`select count(*)::int as n from contracts.index_outbox where entity_id = ${id}`
    )[0]?.n ?? 0;

  it("renew ghi index_outbox cho HĐ gia hạn mới", async () => {
    const id = await done();
    await run((tx) => applyExpiringOutcome(tx, T, { ref: id, actorId: U, outcome: "renew" }));
    const kid = (
      await o<{ id: string }[]>`select id from contracts.contracts where renews_id = ${id}`
    )[0]?.id as string;
    expect(await outbox(kid)).toBeGreaterThan(0);
  });

  it("bản nháp gia hạn đã bị từ chối ⇒ không tính, renew lại được", async () => {
    const id = await done();
    await run((tx) => applyExpiringOutcome(tx, T, { ref: id, actorId: U, outcome: "renew" }));
    await o.begin(async (t) => {
      await t.unsafe("select set_config('contracts.state_gate', 'bulk:' || txid_current(), true)");
      await t`update contracts.contracts set status = 'reject' where renews_id = ${id}`;
    });
    const again = await run((tx) =>
      applyExpiringOutcome(tx, T, { ref: id, actorId: U, outcome: "renew" }),
    );
    expect(again).toBe("applied");
    expect((await o`select 1 from contracts.contracts where renews_id = ${id}`).length).toBe(2);
  });

  it("hook gia hạn đặt renewed lên BẢN HIỆN HÀNH của chuỗi, không lên bản đã bị thay", async () => {
    const v1 = await done();
    const v2 = await done({ version_no: 2, supersedes_id: v1, root_id: v1 });
    await o`update contracts.contracts set superseded_at = now(), superseded_by = ${v2} where id = ${v1}`;
    const kid = await done({ status: "draft", renews_id: v1 });
    await run((tx) => renewalDoneHook.onDone(tx, T, kid));
    expect((await row(v2))?.effect_outcome).toBe("renewed");
    expect((await row(v1))?.effect_outcome).toBeNull();
  });

  it("không xác định được người thao tác (app.user_id trống + không có dự phòng) ⇒ lỗi rõ", async () => {
    await expect(
      run(async (tx) => {
        await tx.execute(sql`select set_config('app.user_id', '', true)`);
        await ensureUser(tx, null);
      }),
    ).rejects.toThrow(/người thao tác/);
  });
});

describe("CR-127 K6 · vòng hiệu lực hằng ngày", () => {
  it("lô theo ngày công ty (VN): 17:00Z đã sang ngày sau ⇒ expiring; hết lịch khi expired", async () => {
    const e = await done({}, "2026-11-11"); // còn 1 ngày theo VN lúc 2026-11-10T20:00Z (= 11/11 VN ⇒ hôm nay là hạn)
    const x = await done({}, "2026-11-10"); // hết hạn hôm qua theo VN
    const act = await done({}, "2027-12-31");
    const rem = createContractReminders(db, {
      timeZoneOf: async () => "Asia/Ho_Chi_Minh",
      now: () => new Date("2026-11-10T20:00:00Z"),
    });
    const t = await rem.drain();
    expect(t.failed).toBe(0);
    expect([(await row(e))?.effect, (await row(x))?.effect, (await row(act))?.effect]).toEqual([
      "expiring",
      "expired",
      "active",
    ]);
    const left = await o<
      { n: number }[]
    >`select count(*)::int as n from contracts.contract_schedule where contract_id = ${x}`;
    expect(left[0]?.n).toBe(0);
  }, 60_000);
});
