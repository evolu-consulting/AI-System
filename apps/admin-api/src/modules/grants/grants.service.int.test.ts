// ADM-FR-32, ADM-FR-35, ADM-FR-53 · grants gọi trực tiếp service: idempotent + bump đúng lúc, batch đếm theo returning,
// batch song song hai chiều (thêm X bớt Y ∥ thêm Y bớt X) không deadlock. Ca xen kẽ tất định ở lib/lock-order.int.test.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb, runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import { isAppError } from "../../lib/errors";
import { batchGrants } from "./grants.batch";
import { type Call, createGrant, deleteGrant } from "./grants.service";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const id = (n: number) => `01900000-0000-7000-8000-0000000ff${String(n).padStart(3, "0")}`;
const TID = id(1);
const ADMIN = id(11);
const [G1, G2] = [id(21), id(22)];
const [F1, F2, CORE, FX] = [id(31), id(32), id(33), id(34)];
const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const db = createDb(API, { max: 6 });
const call: Call = {
  ctx: { db },
  actor: { userId: ADMIN, tenantId: TID, role: "tenant_admin" },
  scope: { kind: "tenant", tenantId: TID },
};
const cfg = async () =>
  (await owner<{ v: number }[]>`select config_version as v from admin.config_meta`)[0]?.v ?? -1;
const rows = async () =>
  (await owner<{ n: number }[]>`select count(*)::int as n from admin.feature_grants`)[0]?.n ?? -1;

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
});
beforeEach(async () => {
  await owner`truncate admin.refresh_tokens, admin.users, admin.tenants, admin.features cascade`;
  await owner`insert into admin.tenants (id, key, name) values (${TID}, 'acme', 'Acme')`;
  await owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, email)
    values (${ADMIN}, ${TID}, 'binh', 'x', 'Binh', 'tenant_admin', 'b@x.test')`;
  await owner`insert into admin.groups (id, tenant_id, key, name) values
    (${G1}, ${TID}, 'kt', '{"vi":"KT"}'), (${G2}, ${TID}, 'kd', '{"vi":"KD"}')`;
  await owner`insert into admin.features (id, key, name) values (${F1}, 'f-1', '{"vi":"F1"}'),
    (${F2}, 'f-2', '{"vi":"F2"}'), (${CORE}, 'core', '{"vi":"Core"}'), (${FX}, 'f-x', '{"vi":"FX"}')`;
  await owner`insert into admin.feature_entitlements (feature_id, tenant_id) values (${F1}, ${TID}), (${F2}, ${TID})`;
});
afterAll(async () => {
  await owner.end();
  await db.close();
});

describe("ADM-FR-32 · grants.service", () => {
  test("POST tạo (+1 config) rồi lặp lại (200, không bump); DELETE hai lần chỉ bump một lần", async () => {
    const v0 = await cfg();
    expect((await createGrant(call, undefined, { feature_id: F1, group_id: G1 })).created).toBe(
      true,
    );
    expect((await createGrant(call, undefined, { feature_id: F1, group_id: G1 })).created).toBe(
      false,
    );
    expect(await cfg()).toBe(v0 + 1);
    await deleteGrant(call, { feature_id: F1, group_id: G1 });
    await deleteGrant(call, { feature_id: F1, group_id: G1 });
    expect(await cfg()).toBe(v0 + 2);
  });

  test("NOT_ENTITLED, CORE_FEATURE_PROTECTED, INVALID_REFERENCE có ids", async () => {
    const err = (p: Promise<unknown>) =>
      p.then(
        () => null,
        (e) => e,
      );
    expect(
      isAppError(
        await err(createGrant(call, undefined, { feature_id: FX, group_id: G1 })),
        "NOT_ENTITLED",
      ),
    ).toBe(true);
    expect(
      isAppError(
        await err(createGrant(call, undefined, { feature_id: CORE, group_id: G1 })),
        "CORE_FEATURE_PROTECTED",
      ),
    ).toBe(true);
    const bad = await err(createGrant(call, undefined, { feature_id: F1, group_id: id(99) }));
    expect(bad.details).toEqual({ field: "group_id", ids: [id(99)] });
  });
});

describe("ADM-FR-35 · batch", () => {
  test("đếm theo returning; áp lại → toàn unchanged, không bump", async () => {
    const body = {
      add: [
        { feature_id: F2, group_id: G2 },
        { feature_id: F1, group_id: G1 },
      ],
      remove: [],
    };
    expect(await batchGrants(call, undefined, body)).toEqual({
      added: 2,
      removed: 0,
      unchanged: 0,
    });
    const v = await cfg();
    expect(await batchGrants(call, undefined, body)).toEqual({
      added: 0,
      removed: 0,
      unchanged: 2,
    });
    expect(await cfg()).toBe(v);
  });

  test("song song: A[bớt X, thêm Y] ∥ B[thêm X, bớt Y] → cả hai thành công, không lỗi", async () => {
    const X = { feature_id: F1, group_id: G1 };
    const Y = { feature_id: F2, group_id: G2 };
    await batchGrants(call, undefined, { add: [X], remove: [] });
    const runs = Array.from({ length: 5 }, () =>
      Promise.all([
        batchGrants(call, undefined, { add: [Y], remove: [X] }),
        batchGrants(call, undefined, { add: [X], remove: [Y] }),
      ]),
    );
    await Promise.all(runs);
    expect(await rows()).toBeGreaterThanOrEqual(0);
  });
});
