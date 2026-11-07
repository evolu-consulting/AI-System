// CR-121 · cr121-c3a-overview-api · int (DB test, role hub_api, scope system): `GET /ops/overview` (service) đọc dữ liệu THẬT.
// Một bộ dữ liệu mồi có đáp án tính tay: lượt chạy 24h/hôm qua, tỷ lệ lỗi, p95 TRỪ thời gian chờ duyệt (= 60 phút), lượt kẹt quá 4 giờ
// (lượt đã chạy lại không tính, chờ người duyệt không tính), 24 cột giờ, lỗi công cụ AI + công cụ lỗi liên tiếp, hạn mức tháng, công ty
// hoạt động, mục "cần xử lý" từ check flow_coverage, phiên bản deploy từ host.json. Đếm số câu SQL (≤ 8 kể cả 2 câu scope) và cache 60 s.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpsOverviewSchema, OVERVIEW_CACHE_TTL_S } from "@ai/contracts/hub-admin";
import { tenantId } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { captureSql } from "@ai/test-kit/perf";
import { connectDb, type Db } from "../../lib/db";
import { makeOverviewServiceFor as makeOverviewService } from "./adapters/overview.wire";
import { insertDify, insertReviewWait, insertRuns, seedBase } from "./test/overview.fixture";

const TA = tenantId(1301);
const TB = tenantId(1302);
const TC = tenantId(1303);
const W1 = "b1000000-0000-4000-8000-000000000001";
const W2 = "b1000000-0000-4000-8000-000000000002";
const W3 = "b1000000-0000-4000-8000-000000000003";
const DEFAULTS = { stuck_hours: 4, quota_pct: 80 };

let o: Sql;
let db: Db;
let dir: string;
let baseCompanies = 0;

const client = (): Sql => (db.db as unknown as { $client: Sql }).$client;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  dir = mkdtempSync(join(tmpdir(), "ov-"));
  writeFileSync(
    join(dir, "host.json"),
    JSON.stringify({
      at: new Date().toISOString(),
      disks: [],
      deploy_ref: "abc1234 (platform/gd0)",
    }),
  );
  const [n] = await o<{ n: number }[]>`select count(*)::int as n from admin.tenants
    where active and key <> 'platform'`;
  baseCompanies = n?.n ?? 0;
  await o`insert into admin.tenants (id, key, name) values (${TA}, 't1301', 'Cty A'), (${TB}, 't1302', 'Cty B'),
    (${TC}, 't1303', 'Cty C')`;
  const b = await seedBase(o, TA, "a");
  const R = {
    rerunSrc: crypto.randomUUID(),
    waited: crypto.randomUUID(),
  };
  await insertRuns(o, b, [
    // ── 24 giờ gần nhất (k = 0) ──
    { tenant: TA, status: "done", startedAgo: 300, finishedAgo: 240 }, // 60 phút
    { id: R.waited, tenant: TA, status: "done", startedAgo: 700, finishedAgo: 580 }, // 120 phút − 60 chờ duyệt = 60
    { tenant: TB, status: "failed", startedAgo: 200, finishedAgo: 190 },
    { tenant: TB, status: "done", startedAgo: 100, finishedAgo: 40 }, // 60 phút
    { tenant: TA, status: "running", startedAgo: 30, updatedAgo: 5 }, // đang chạy, không kẹt
    { tenant: TB, status: "needs_decision", startedAgo: 600, updatedAgo: 500 }, // kẹt (> 4 giờ)
    { tenant: TA, status: "running", startedAgo: 1000, updatedAgo: 400 }, // kẹt
    { tenant: TB, status: "waiting_review", startedAgo: 900, updatedAgo: 800 }, // chờ người: KHÔNG kẹt
    // ── hôm qua (k = 1) ──
    { tenant: TA, status: "done", startedAgo: 1600, finishedAgo: 1580 },
    { tenant: TA, status: "failed", startedAgo: 1700, finishedAgo: 1690 }, // lỗi > 4 giờ, chưa chạy lại ⇒ kẹt
    { id: R.rerunSrc, tenant: TB, status: "failed", startedAgo: 1800, finishedAgo: 1790 },
    { tenant: TB, status: "done", startedAgo: 1785, finishedAgo: 1770, rerunOf: R.rerunSrc }, // đã chạy lại ⇒ lỗi trên KHÔNG kẹt
    // ── k = 3 và ngoài 7 ngày ──
    { tenant: TA, status: "done", startedAgo: 5000, finishedAgo: 4990 },
    { tenant: TA, status: "done", startedAgo: 12000, finishedAgo: 11990 },
  ]);
  await insertReviewWait(o, TA, R.waited, 640, 580);
  await insertDify(o, [
    ...[10, 20, 30].map((ago) => ({ workflow: W1, tenant: TA, status: "failed" as const, ago })),
    { workflow: W1, tenant: TA, status: "ok", ago: 200 },
    { workflow: W2, tenant: TA, status: "ok", ago: 5 },
    { workflow: W2, tenant: TA, status: "failed", ago: 50 },
    { workflow: W2, tenant: TA, status: "failed", ago: 100 },
    { workflow: W3, tenant: TB, status: "failed", ago: 1700 }, // hôm qua
  ]);
  await o`insert into admin.tenant_quotas (tenant_id, max_usd) values (${TA}, 100), (${TB}, 50)`;
  await o`insert into hub.usage_logs (tenant_id, run_id, billing, input_tokens, output_tokens, billable_usd, at)
    values (${TA}, gen_random_uuid(), 'api', 10, 5, 30, now() - interval '1 minute'),
           (${TB}, gen_random_uuid(), 'api', 10, 5, 45, now() - interval '1 minute')`;
  await o`insert into hub.ops_checks (check_key, status, value, message, checked_at, changed_at)
    values ('flow_coverage', 'crit', ${JSON.stringify({
      checked: 3,
      gap_count: 2,
      gaps: [
        { slot: "s", tenant: "Cty A", effective: true },
        { slot: "s", tenant: "Cty B", effective: true },
      ],
      unrouted: ["Cty A"],
      broken: [],
    })}::text::jsonb, 'x', now(), now())`;
}, 180_000);

afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("GET /ops/overview · tính đúng trên dữ liệu mồi", () => {
  it("KPI, 24 cột giờ, cần xử lý, sức khoẻ khớp đáp án tính tay và qua schema hợp đồng", async () => {
    const svc = makeOverviewService({ db, statusDir: dir });
    const out = OpsOverviewSchema.parse(await svc.get(DEFAULTS, "platform_admin"));
    const k = out.kpi;
    expect(k.runs).toMatchObject({
      value: 8,
      yesterday: 4,
      running: 3,
      failed: 1,
      needs_decision: 1,
    });
    expect(k.runs.series).toHaveLength(7);
    expect(k.runs.series[3]).toBe(1); // k = 3
    expect(k.error_rate).toMatchObject({ value: 25, yesterday: 50, ended: 4, failed: 1 });
    expect(k.p95).toMatchObject({ minutes: 60, n: 3, p95_basis: "excluding_review_wait" });
    expect(k.ai_tool_errors).toMatchObject({ value: 5, yesterday: 1 });
    expect(k.ai_quota).toMatchObject({
      used_usd: 75,
      limit_usd: 150,
      used_pct: 50,
      tenants_with_limit: 2,
    });
    expect(k.companies.total).toBe(baseCompanies + 3);
    expect(k.companies.active_7d).toBe(2); // A, B (C không hoạt động)
    // 24 cột giờ: xong ở cột −4 giờ (h=4), −9 giờ (h=9), −0 giờ; lỗi ở h=3.
    expect(out.hourly).toHaveLength(24);
    const col = (h: number) => out.hourly[23 - h];
    expect(col(4)).toMatchObject({ ok: 1, error: 0 });
    expect(col(9)).toMatchObject({ ok: 1, error: 0 });
    expect(col(0)).toMatchObject({ ok: 1, error: 0 });
    expect(col(3)).toMatchObject({ ok: 0, error: 1 });
    // Cần xử lý ngay.
    expect(out.attention.stuck_runs).toMatchObject({ count: 3, hours: 4 });
    expect(out.attention.unrouted_companies.count).toBe(2);
    expect(out.attention.failing_ai_tools).toMatchObject({ count: 1, streak: 3 });
    expect(out.attention.near_quota_companies).toMatchObject({ count: 1, pct: 80 });
    expect(out.attention.half_configured.count).toBe(1);
    for (const a of Object.values(out.attention)) expect(a.link.startsWith("/")).toBe(true);
    // Sức khoẻ.
    expect(out.health.dify).toMatchObject({ calls_1h: 5, errors_24h: 5, error_rate_1h: 80 });
    expect(out.health.dify.top_failing_tool).toMatchObject({ id: W1, errors: 3 });
    expect(out.health.db.ok).toBe(true);
    expect(out.health.db.connections).toBeGreaterThan(0);
    expect(out.health.deploy.version).toBe("abc1234 (platform/gd0)");
  });

  it("ngưỡng cấu hình: stuck_hours = 12 ⇒ chỉ còn lượt lỗi cũ hơn 12 giờ (1), quota_pct = 95 ⇒ không công ty nào", async () => {
    const svc = makeOverviewService({ db, statusDir: dir });
    const out = await svc.get({ stuck_hours: 12, quota_pct: 95 }, "platform_admin");
    expect(out.attention.stuck_runs.count).toBe(1);
    expect(out.attention.near_quota_companies.count).toBe(0);
  });

  it("số câu SQL cố định ≤ 8 (kể cả scope), lần gọi thứ hai trong 60 s dùng cache (0 câu), hết hạn ⇒ tính lại", async () => {
    let t = Date.now();
    const svc = makeOverviewService({ db, statusDir: dir, now: () => new Date(t) });
    const first = await captureSql(client(), () => svc.get(DEFAULTS, "platform_admin"));
    expect(first.queries.length).toBeLessThanOrEqual(8);
    expect(first.queries.length).toBeGreaterThanOrEqual(6);
    const again = await captureSql(client(), () => svc.get(DEFAULTS, "platform_admin"));
    expect(again.queries.length).toBe(0);
    expect(again.r).toBe(first.r);
    t += OVERVIEW_CACHE_TTL_S * 1000 + 1;
    const stale = await captureSql(client(), () => svc.get(DEFAULTS, "platform_admin"));
    expect(stale.queries.length).toBe(first.queries.length);
    // Số câu không phụ thuộc số công ty/lượt chạy: thêm dữ liệu rồi đo lại.
    const b = await seedBase(o, TC, "c");
    await insertRuns(o, b, [{ tenant: TC, status: "done", startedAgo: 10, finishedAgo: 5 }]);
    t += OVERVIEW_CACHE_TTL_S * 1000 + 1;
    const more = await captureSql(client(), () => svc.get(DEFAULTS, "platform_admin"));
    expect(more.queries.length).toBe(first.queries.length);
    // Vai kiểm ngay trong service: kể cả khi cache còn nóng, không phải platform_admin ⇒ FORBIDDEN, 0 câu SQL.
    for (const role of ["tenant_admin", "member"] as const) {
      const denied = await captureSql(client(), () =>
        svc.get(DEFAULTS, role).then(
          () => null,
          (e: unknown) => e,
        ),
      );
      expect((denied.r as { code?: string } | null)?.code).toBe("FORBIDDEN");
      expect(denied.queries.length).toBe(0);
    }
  });
});
