// CR-114 · hub-agent-handoff · viết TRƯỚC code: cách ly tenant bảng `hub.artifacts` (0084). Đường chạy thật: `hub_api` +
// `app.scope` (`inHub`, như `withHubScope`); dữ liệu dựng bằng owner. Đọc chéo / ghi chéo / thăm dò tồn tại / không scope.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenantId, userId } from "@ai/test-kit/builders";
import { cloneDb, type HubScopeArg, inHub, openOwner, type Sql } from "@ai/test-kit/db";

const T = { a: tenantId(1141), b: tenantId(1142) };
const U = { a: userId(1141), b: userId(1142) };
const KEY_A = "a".repeat(64);
const KEY_NONE = "f".repeat(64);
const RUN_A = "00000000-0000-4000-8000-000000011410";
const sys: HubScopeArg = { kind: "system" };
const user = (k: "a" | "b"): HubScopeArg => ({ kind: "user", tenantId: T[k], userId: U[k] });

let o: Sql;

const count = (scope: HubScopeArg | "none", q: string, p: unknown[] = []) =>
  inHub(scope, async (tx) => {
    const r = (await tx.unsafe(q, p as never[])) as unknown as { n: number }[];
    return r[0]?.n ?? -1;
  });
const write = async (scope: HubScopeArg, q: string, p: unknown[] = []): Promise<string> => {
  try {
    return await inHub(scope, async (tx) => {
      const n = (await tx.unsafe(q, p as never[])).count;
      throw Object.assign(new Error("rollback"), { n });
    });
  } catch (e) {
    const x = e as { n?: number; code?: string };
    return x.n !== undefined ? String(x.n) : (x.code ?? "no-code");
  }
};

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  await o`insert into admin.tenants (id, key, name) values (${T.a}, 't1141', 'T1141'), (${T.b}, 't1142', 'T1142')
    on conflict do nothing`;
  await o`insert into hub.artifacts (tenant_id, key, kind, body, size_bytes, tokens, summary, expires_at)
    values (${T.a}, ${KEY_A}, 'text', 'bí mật của A', 15, 4, 'A', now() + interval '1 day')`;
  await o`insert into hub.artifact_runs (tenant_id, run_id, key) values (${T.a}, ${RUN_A}, ${KEY_A})`;
}, 300_000);
afterAll(async () => {
  await o?.end({ timeout: 2 });
});

const Q = "select count(*)::int as n from hub.artifacts where key = $1";

describe("CR-114 · RLS hub.artifacts", () => {
  it("chặn đọc chéo tenant bảng artifacts", async () => {
    expect({
      own: await count(user("a"), Q, [KEY_A]),
      cross: await count(user("b"), Q, [KEY_A]),
      noScope: await count("none", Q, [KEY_A]),
      sys: await count(sys, Q, [KEY_A]),
    }).toEqual({ own: 1, cross: 0, noScope: 0, sys: 1 });
    // Thăm dò tồn tại: khoá của A dưới B ≡ khoá không tồn tại.
    expect(await count(user("b"), Q, [KEY_A])).toBe(await count(user("b"), Q, [KEY_NONE]));
    const ins = `insert into hub.artifacts (tenant_id, key, kind, body, size_bytes, tokens, summary, expires_at)
      values ($1, $2, 'text', 'x', 1, 1, '', now() + interval '1 day')`;
    expect({
      insCross: await write(user("b"), ins, [T.a, KEY_NONE]),
      insOwn: await write(user("b"), ins, [T.b, KEY_NONE]),
      updCross: await write(user("b"), "update hub.artifacts set body = 'x' where key = $1", [
        KEY_A,
      ]),
      delCross: await write(user("b"), "delete from hub.artifacts where key = $1", [KEY_A]),
    }).toEqual({ insCross: "42501", insOwn: "1", updCross: "0", delCross: "0" });
  });

  it("chặn đọc/ghi chéo tenant bảng artifact_runs", async () => {
    const L = "select count(*)::int as n from hub.artifact_runs where key = $1";
    expect({
      own: await count(user("a"), L, [KEY_A]),
      cross: await count(user("b"), L, [KEY_A]),
      noScope: await count("none", L, [KEY_A]),
    }).toEqual({ own: 1, cross: 0, noScope: 0 });
    expect({
      // Tenant B tự gắn run của mình vào artifact của A ⇒ bị chặn (RLS WITH CHECK).
      linkCross: await write(
        user("b"),
        "insert into hub.artifact_runs (tenant_id, run_id, key) values ($1, $2, $3)",
        [T.a, RUN_A.replace(/0$/, "1"), KEY_A],
      ),
      delCross: await write(user("b"), "delete from hub.artifact_runs where key = $1", [KEY_A]),
    }).toEqual({ linkCross: "42501", delCross: "0" });
  });
});
