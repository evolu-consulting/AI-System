// CR-126 · cr126-child-task-visible · «Quy trình mua hàng» thật (seed `writeCr125Config`, mẫu Thư viện Phần 1–3 chạy làm lượt con): nhân viên
// bắt đầu bằng phiếu (`POST /processes/start` = `ManualStartService.start`) ⇒ lượt con Phần 1 chờ bước «Đề xuất nhu cầu mua» ⇒ việc đó nằm
// trong «Chờ tôi duyệt» (`GET /me/review-tasks` = `listReviewTasks`, màn /contracts/requests lọc `open && can_act`) của nhân viên.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Role } from "@ai/contracts/common";
import { users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import type { AuthUser } from "../../../../lib/auth.middleware";
import { connectDb, type Db } from "../../../../lib/db";
import { ConfigCache, dbConfigSource } from "../../../config/config.service";
import { notifyConfigChanged, writeCr125Config } from "../../../seed/seed.cr125-config";
import type { ProcessDeps } from "../../core/ports";
import { PURCHASE_PARENT_KEY } from "../../library/purchase-templates";
import { listReviewTasks } from "../../notify/inbox.service";
import { createStageLauncher } from "../../runs/launcher";
import { ManualStartService } from "../../triggers/manual-start.service";

const T = "00000000-0000-4000-8000-000000012601";
const TK = "t12601";
let o: Sql;
let db: Db;
let d: ProcessDeps;
let EMP = "";
let DIR = "";
let cache: ConfigCache;
const log = { warn: () => {}, info: () => {}, error: () => {} };

const pipe: unknown = new Proxy(
  {},
  { get: (_, k) => (k === "exec" ? async () => [] : () => pipe) },
);
function mkDeps(): ProcessDeps {
  const x = {
    db,
    // cache cấu hình THẬT (như hub chạy): `groupIds` của người xem đến từ đây ⇒ lộ đúng lỗi cache cũ của e2e.
    config: cache,
    redis: { pipeline: () => pipe },
    notifier: new Proxy({}, { get: () => async () => [] }),
    log,
    now: () => new Date(),
    runsPerTenant: 100,
    postThread: async () => {},
  } as unknown as ProcessDeps & { launcher: unknown };
  x.launcher = createStageLauncher(x as never);
  return x;
}
const as = (userId: string): AuthUser =>
  ({ tenantId: T, userId, role: "member" as Role }) as AuthUser;

/** Gán nhóm bằng SQL như e2e `cr125-purchase-full` (màn thành viên nhóm thì admin-api tự báo cache). */
async function member(userId: string, keys: readonly string[]): Promise<void> {
  await o`insert into admin.group_members (tenant_id, group_id, user_id)
    select ${T}, g.id, ${userId} from admin.groups g where g.tenant_id = ${T} and g.key = any(${[...keys]}::text[])`;
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 6);
  cache = new ConfigCache(dbConfigSource(db), { pollS: 3600, log: log as never });
  await o`insert into admin.tenants (id, key, name) values (${T}, ${TK}, 'T')`;
  [EMP, DIR] = (await users(o, T, 2, { from: 12_601 })) as [string, string];
  await o`insert into admin.feature_entitlements (feature_id, tenant_id, granted_by)
    select f.id, ${T}, null from admin.features f where f.key = 'contracts-read' on conflict do nothing`;
  await o.begin((tx) => writeCr125Config(tx as never, [TK]));
  // người dùng đã đăng nhập TRƯỚC khi được gán nhóm (e2e: tài khoản dùng chung của công ty journey) ⇒ cache giữ `groupIds` rỗng.
  await cache.poll();
  await Promise.all([cache.user(EMP), cache.user(DIR)]);
  await member(EMP, ["nhan-vien-phong-ban"]);
  await member(DIR, ["nhan-vien-phong-ban", "truong-bo-phan", "mua-hang", "giam-doc"]);
  d = mkDeps();
}, 120_000);
afterAll(async () => {
  await cache?.stop();
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-126 · việc đầu của lượt con hiện trong «Chờ tôi duyệt»", () => {
  it("nhân viên bắt đầu «Quy trình mua hàng» ⇒ bước «Đề xuất nhu cầu mua» của Phần 1 nằm trong /me/review-tasks, làm được", async () => {
    const r = await new ManualStartService(d).start(as(EMP), {
      flow_key: PURCHASE_PARENT_KEY,
      request_id: crypto.randomUUID(),
      values: { ten_hang: "Máy in", gia_du_kien: 1_000_000 },
    } as never);
    const kids = await o<{ id: string; status: string; started_by: string }[]>`
      select id, status, started_by from hub.process_runs where parent_run_id = ${r.run_id}`;
    expect(kids.map((k) => k.status)).toEqual(["waiting_review"]);
    const kid = kids[0]?.id as string;
    expect(kids[0]?.started_by).toBe(EMP); // lượt con kế thừa người bắt đầu của lượt cha
    const waiting = async (who: string) =>
      (await listReviewTasks(d, as(who), { status: "open", limit: 50 })).items
        .filter((i) => i.task.status === "open" && i.task.can_act)
        .map((i) => i.process_run.id);
    // lỗi e2e: nhóm ghi bằng SQL, KHÔNG báo cache ⇒ Hub còn groupIds cũ ⇒ «Chờ tôi duyệt» trống với cả hai người
    expect(await waiting(EMP)).not.toContain(kid);
    expect(await waiting(DIR)).not.toContain(kid);
    // sửa: báo cache như màn thành viên nhóm (một luật `notifyConfigChanged`) ⇒ cả hai thành viên nhóm thấy việc
    await o.begin((tx) => notifyConfigChanged(tx as never, [TK]));
    await cache.poll();
    expect(await waiting(EMP)).toContain(kid);
    expect(await waiting(DIR)).toContain(kid);
  });
});
