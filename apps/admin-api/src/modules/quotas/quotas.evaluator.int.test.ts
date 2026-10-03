// ADM-FR-41 · M4-R04, R05 · plan M4 §5.2: evaluator chạy song song không gửi trùng (claim), không người nhận → skipped,
// lỗi lần thứ 5 → failed, claim `sending` quá hạn được nhận lại, tenant không quota → 0 alert.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createDb, runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import { createMemoryMailer, MailError, type Mailer } from "../../lib/mailer";
import { evaluateTenant } from "./quotas.evaluator";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const n = (k: number) => `01900000-0000-7000-8000-0000000ee${String(k).padStart(3, "0")}`;
const [TID, BOSS] = [n(1), n(2)];
const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const db = createDb(API, { max: 6 });
const ctx = (mailer: Mailer) => ({ db, now: () => new Date(), mailer, webUrl: "http://web.test/" });
const failing = (): Mailer => ({
  async send() {
    throw new MailError("MAIL_SEND_FAILED");
  },
});
const alerts = async () => [
  ...(await owner<
    { level: number; status: string; attempts: number }[]
  >`select level, status, attempts
    from admin.quota_alerts where tenant_id = ${TID} order by level`),
];

async function usage(runs: number): Promise<void> {
  const rows = Array.from({ length: runs }, () => ({
    tenant_id: TID,
    run_id: crypto.randomUUID(),
    billing: "api",
  }));
  await owner`insert into hub.usage_logs ${owner(rows)}`;
}

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
});
beforeEach(async () => {
  await owner`delete from hub.usage_logs where tenant_id = ${TID}`;
  await owner`truncate admin.quota_alerts, admin.tenant_quotas, admin.users, admin.tenants cascade`;
  await owner`insert into admin.tenants (id, key, name) values (${TID}, 'evq', 'Ev Q')`;
  await owner`insert into admin.users (id, tenant_id, username, email, password_hash, display_name, role)
    values (${BOSS}, ${TID}, 'boss', 'boss@evq.test', 'h', 'Boss', 'tenant_admin')`;
  await owner`insert into admin.tenant_quotas (tenant_id, max_runs) values (${TID}, 10)`;
});
afterAll(async () => {
  await owner`delete from hub.usage_logs where tenant_id = ${TID}`;
  await db.close();
  await owner.end();
});

describe("ADM-FR-41 · M4-R04 · evaluator", () => {
  it("EV1 · 3 evaluator song song (8/10) → 1 alert 80 sent, đúng 1 mail; link {webUrl}/usage", async () => {
    await usage(8);
    const m = createMemoryMailer();
    await Promise.all([1, 2, 3].map(() => evaluateTenant(ctx(m), TID)));
    expect(await alerts()).toEqual([{ level: 80, status: "sent", attempts: 0 }]);
    expect(m.sent.map((x) => x.to)).toEqual([["boss@evq.test"]]);
    expect(m.sent[0]?.text).toContain("http://web.test/usage");
  });

  it("EV2 · không tenant_admin active có email → alert skipped, 0 mail", async () => {
    await owner`update admin.users set active = false where id = ${BOSS}`;
    await usage(8);
    const m = createMemoryMailer();
    await evaluateTenant(ctx(m), TID);
    expect(await alerts()).toEqual([{ level: 80, status: "skipped", attempts: 0 }]);
    expect(m.sent).toHaveLength(0);
  });
});

describe("ADM-FR-41 · M4-R05 · evaluator: lỗi gửi, claim quá hạn", () => {
  it("EV3 · lỗi gửi 5 lần → failed, không thử lại nữa", async () => {
    await usage(10);
    for (let i = 0; i < 6; i++) await evaluateTenant(ctx(failing()), TID);
    expect(await alerts()).toEqual([
      { level: 80, status: "skipped", attempts: 0 },
      { level: 100, status: "failed", attempts: 5 },
    ]);
  });

  it("EV4 · `sending` quá 5 phút được claim lại; `sending` mới thì không", async () => {
    await usage(8);
    await owner`insert into admin.quota_alerts (tenant_id, level, month, pct, status, claimed_at)
      values (${TID}, 80, date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh')::date, 80, 'sending', now())`;
    const m = createMemoryMailer();
    await evaluateTenant(ctx(m), TID);
    expect(m.sent).toHaveLength(0);
    await owner`update admin.quota_alerts set claimed_at = now() - interval '6 minutes' where tenant_id = ${TID}`;
    await evaluateTenant(ctx(m), TID);
    expect(m.sent).toHaveLength(1);
    expect((await alerts())[0]?.status).toBe("sent");
  });

  it("EV5 · không quota → 0 alert; mailer vắng → MAIL_DISABLED giữ pending", async () => {
    await owner`delete from admin.tenant_quotas where tenant_id = ${TID}`;
    await usage(50);
    await evaluateTenant({ db, now: () => new Date() }, TID);
    expect(await alerts()).toEqual([]);
    await owner`insert into admin.tenant_quotas (tenant_id, max_runs) values (${TID}, 10)`;
    await evaluateTenant({ db, now: () => new Date() }, TID);
    const [r] =
      await owner`select status, last_error from admin.quota_alerts where tenant_id = ${TID} and level = 100`;
    expect([r?.status, r?.last_error]).toEqual(["pending", "MAIL_DISABLED"]);
  });
});
