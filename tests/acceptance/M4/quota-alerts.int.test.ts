// ADM-FR-41 · M4-R04, R05, R06 · Q2b · cảnh báo quota 80/100 % qua evaluator (test-plan AL1–AL9, AL11; M4-AC01, M4-AC18).
// App in-process, `deps.mailer` giả (`env.mailer`). PUT không chờ evaluator → mọi khẳng định alert/mail bằng `poll`.
// "Không có gì thêm" = sentinel: PUT quota globex vượt 80 % → chờ mail tới hoa rồi mới khẳng định phía acme. Xanh ở T4.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  alertRows,
  createM4Env,
  expectErr4,
  ID,
  insertUsage,
  type M4Env,
  mailsTo,
  parse4,
  poll,
  putQuota,
  qi,
  quotaPath,
  resetNow,
  setQuota,
  TENANT_ID,
  vnMonthStart,
} from "./_ab";

let env: M4Env;
const A = TENANT_ID.acme;
const G = TENANT_ID.globex;
const KT = ID.feature.keToan;
const BINH = "binh@acme.test";
const CHI = "chi@acme.test";
const sub = (pct: number) => `[Acme Corp] Đã dùng ${pct}% quota tháng`;
const subjects = (email: string) => mailsTo(env, email).map((m) => m.subject);
const count = (pct: number) => env.mailer.sent.filter((m) => m.subject === sub(pct)).length;
const statuses = async () =>
  (await alertRows(env, A)).map((r) => `${r.feature_id ?? "null"}:${r.level}:${r.status}`);

beforeAll(async () => {
  env = await createM4Env();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await resetNow(env);
});

/** Sentinel: globex 90 run; n=1 quota 100 (mail 80), n=2 quota 90 (mail 100) → chờ mail thứ `n` tới hoa. */
async function sentinel(n: 1 | 2 = 1): Promise<void> {
  if (n === 1) await insertUsage(env.owner, 90, { tenant: G });
  expect((await putQuota(env, G, [qi(null, { runs: n === 1 ? 100 : 90 })])).status).toBe(200);
  await poll(() => mailsTo(env, "hoa@globex.test").length >= n, true);
}

describe("ADM-FR-41 · M4-R04 · phát cảnh báo", () => {
  it("ADM-FR-41 · M4-AC01 · AL1 + AL2 · 800/1000 → 1 alert 80 sent, 2 mail (mỗi mail 1 người: binh, chi), link /usage; +200 run → mail 100 ×2, mail 80 vẫn 2", async () => {
    await insertUsage(env.owner, 800, { tenant: A });
    expect((await putQuota(env, A, [qi(null, { runs: 1000 })])).status).toBe(200);
    await poll(statuses, ["null:80:sent"]);
    expect(env.mailer.sent.every((m) => m.to.length === 1)).toBe(true);
    expect(subjects(BINH)).toEqual([sub(80)]);
    expect(subjects(CHI)).toEqual([sub(80)]);
    expect(env.mailer.sent).toHaveLength(2);
    expect(mailsTo(env, BINH)[0]?.text).toContain("/usage");
    // AL2
    await insertUsage(env.owner, 200, { tenant: A });
    expect((await putQuota(env, A, [qi(null, { runs: 1000, tokens: 10_000_000 })])).status).toBe(
      200,
    );
    await poll(statuses, ["null:80:sent", "null:100:sent"]);
    expect(count(100)).toBe(2);
    expect(count(80)).toBe(2);
  });

  it("ADM-FR-41 · M4-R04 · AL3 · 1000/1000 chưa có alert → chỉ mail 100 (2 người); hàng 80 skipped, không mail 80 về sau", async () => {
    await insertUsage(env.owner, 1000, { tenant: A });
    expect((await putQuota(env, A, [qi(null, { runs: 1000 })])).status).toBe(200);
    await poll(() => count(100), 2);
    await sentinel();
    expect(count(80)).toBe(0);
    expect(await statuses()).toEqual(["null:80:skipped", "null:100:sent"]);
  });

  it("ADM-FR-41 · M4-R05 · AL4 · chi locale en → subject EN; lan (member, có email) không nhận", async () => {
    await env.owner`update admin.users set locale = 'en' where username = 'chi'`;
    await insertUsage(env.owner, 800, { tenant: A });
    expect((await putQuota(env, A, [qi(null, { runs: 1000 })])).status).toBe(200);
    await poll(() => env.mailer.sent.length, 2);
    expect(subjects(BINH)).toEqual([sub(80)]);
    expect(subjects(CHI)).toEqual(["[Acme Corp] 80% of monthly quota used"]);
    expect(mailsTo(env, "lan@acme.test")).toHaveLength(0);
  });

  it("ADM-FR-41 · M4-R05 · AL4 · chi active=false rồi chi active nhưng role member (tenant_admin luôn có email — CHECK M1) → chỉ binh nhận", async () => {
    await env.owner`update admin.users set active = false where username = 'chi'`;
    await insertUsage(env.owner, 800, { tenant: A });
    expect((await putQuota(env, A, [qi(null, { runs: 1000 })])).status).toBe(200);
    await poll(statuses, ["null:80:sent"]);
    await sentinel();
    expect(
      env.mailer.sent.filter((m) => m.subject.startsWith("[Acme Corp]")).map((m) => m.to),
    ).toEqual([[BINH]]);
    await env.owner`update admin.users set active = true, role = 'member' where username = 'chi'`;
    await insertUsage(env.owner, 200, { tenant: A });
    expect((await putQuota(env, A, [qi(null, { runs: 1000, tokens: 9_000_000 })])).status).toBe(
      200,
    );
    await poll(() => count(100), 1);
    await sentinel(2);
    expect(mailsTo(env, BINH).map((m) => m.subject)).toEqual([sub(80), sub(100)]);
    expect(count(100)).toBe(1);
  });

  it("ADM-FR-41 · M4-R04 · AL8 · quota ke-toan 100 run; 85 run ke-toan + 500 run khác → alert (ke-toan, 80); không alert tenant", async () => {
    await insertUsage(env.owner, 85, { tenant: A, feature: KT });
    await insertUsage(env.owner, 500, { tenant: A });
    expect((await putQuota(env, A, [qi(KT, { runs: 100 })])).status).toBe(200);
    await poll(statuses, [`${KT}:80:sent`]);
    expect(count(80)).toBe(2);
  });
});

describe("ADM-FR-41 · M4-AC02 · không phát", () => {
  it("ADM-FR-41 · M4-AC02 · AL7 · không quota, 5000 run, NOTIFY quota_threshold acme → 0 alert, 0 mail", async () => {
    await insertUsage(env.owner, 5000, { tenant: A });
    await env.notifyQuota(A);
    await sentinel();
    expect(await alertRows(env, A)).toHaveLength(0);
    expect(mailsTo(env, BINH)).toHaveLength(0);
  });

  it("ADM-FR-41 · M4-R01 · AL9 · 900 run lúc đầu tháng VN − 1 s + 100 run trong tháng, quota 1000 → pct 10, không alert", async () => {
    const at = new Date(vnMonthStart(new Date()).getTime() - 1000);
    await insertUsage(env.owner, 900, { tenant: A, at });
    await insertUsage(env.owner, 100, { tenant: A });
    expect((await putQuota(env, A, [qi(null, { runs: 1000 })])).status).toBe(200);
    const b = parse4("QuotaSetResponseSchema", (await env.as("GET", quotaPath(A))).json);
    expect(b.items[0].used.runs).toBe(100);
    expect(b.items[0].pct).toBe(10);
    await sentinel();
    expect(await alertRows(env, A)).toHaveLength(0);
  });
});

describe("ADM-FR-41 · M4-AC18 · mail lỗi", () => {
  it("ADM-FR-41 · M4-R05 · M4-AC18 · AL5 · MAIL_SEND_FAILED → PUT 200, quota lưu; alert pending, attempts 1, last_error mã; mailer tốt + NOTIFY quota_threshold → sent", async () => {
    env.mailer.fail = "MAIL_SEND_FAILED";
    await insertUsage(env.owner, 800, { tenant: A });
    expect((await putQuota(env, A, [qi(null, { runs: 1000 })])).status).toBe(200);
    const [q] = await env.owner`select max_runs from admin.tenant_quotas where tenant_id = ${A}`;
    expect(q?.max_runs).toBe(1000);
    await poll(async () => {
      const [r] = await alertRows(env, A);
      return r ? [r.status, r.attempts, r.last_error] : null;
    }, ["pending", 1, "MAIL_SEND_FAILED"]);
    env.mailer.fail = null;
    await env.notifyQuota(A);
    await poll(statuses, ["null:80:sent"]);
    expect(count(80)).toBe(2);
  });

  it("ADM-FR-41 · M4-R05 · M4-AC18 · AL6 · MAIL_DISABLED → giữ pending như lỗi gửi", async () => {
    env.mailer.fail = "MAIL_DISABLED";
    await insertUsage(env.owner, 800, { tenant: A });
    expect((await putQuota(env, A, [qi(null, { runs: 1000 })])).status).toBe(200);
    await poll(async () => {
      const [r] = await alertRows(env, A);
      return r ? [r.status, r.attempts, r.last_error] : null;
    }, ["pending", 1, "MAIL_DISABLED"]);
    expect(env.mailer.sent).toHaveLength(0);
  });
});

describe("ADM-FR-41 · M4-R06 · quota-banner", () => {
  const banner = async (user = "binh") => env.by("acme", user)("GET", "/admin/quota-banner");

  it("ADM-FR-41 · M4-R06 · M4-AC01 · AL11 · binh 800/1000 → {warn,80,null}; 1000 → over; usage giảm 700 → null; admin → null; an → 403", async () => {
    await setQuota(env.owner, A, null, { runs: 1000 });
    await insertUsage(env.owner, 800, { tenant: A });
    let res = await banner();
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ banner: { level: "warn", pct: 80, feature_key: null } });
    parse4("QuotaBannerSchema", res.json.banner);
    await insertUsage(env.owner, 200, { tenant: A });
    res = await banner();
    expect(res.json).toEqual({ banner: { level: "over", pct: 100, feature_key: null } });
    await env.owner`delete from hub.usage_logs where run_id in (
      select run_id from hub.usage_logs where tenant_id = ${A} order by run_id limit 300)`;
    expect((await banner()).json).toEqual({ banner: null });
    const adm = await env.as("GET", "/admin/quota-banner");
    expect(adm.status).toBe(200);
    expect(adm.json).toEqual({ banner: null });
    expectErr4(await banner("an"), "FORBIDDEN");
  });

  it("ADM-FR-41 · M4-R06 · AL11 · không quota (5000 run) → banner null", async () => {
    await insertUsage(env.owner, 5000, { tenant: A });
    const res = await banner();
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ banner: null });
  });
});
