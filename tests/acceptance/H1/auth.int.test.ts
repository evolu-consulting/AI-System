// HUB-FR-01, 74, 88 · HUB-H1-AC-09, AC-31 · H1-R02, H1-R04 · test-plan H1 §5 A1–A3: xác thực JWT, tenant/user khoá, /health.
// Hộp đen: HTTP vào hub-api thật (`createApp`) + DB `ai_system_h1_test` (fixture SQL owner, `_fixtures.ts`).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { HealthResponseSchema } from "@ai/contracts/chat";
import {
  adminChange,
  type CallOpts,
  call,
  counts,
  endpoints,
  err,
  errorOf,
  type Hub,
  insertFixture,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  R,
  type Sql,
  sign,
  startHub,
  T,
  USERS,
  waitFor,
} from "./_fixtures";

let sql: Sql;
let k: Keys;
let hub: Hub;

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  k = await makeKeys();
  hub = await startHub(k);
}, 60_000);
afterAll(async () => {
  await hub?.stop();
  await sql?.end();
});

/** A1 chỉ xét E5, E7, E11–E15 (test-plan §5). */
const A1_EPS = endpoints(R.conv, R.flow2, R.runLive).filter((e) =>
  ["E5", "E7", "E11", "E11+flow", "E12", "E12+flow", "E13", "E14", "E15"].includes(e.name),
);

/** Gọi mọi endpoint A1 với `o`; trả map tên → {status, code}. */
async function sweep(o: CallOpts) {
  const out: Record<string, { status: number; code: string | undefined }> = {};
  for (const e of A1_EPS)
    out[e.name] = errorOf(await call(hub, e.method, e.path, { ...o, body: e.body }));
  return out;
}
const all401 = () => Object.fromEntries(A1_EPS.map((e) => [e.name, err("AUTH_EXPIRED")]));

async function expect401Everywhere(o: CallOpts): Promise<void> {
  const before = await counts(sql);
  expect(await sweep(o)).toEqual(all401());
  // E12 bị từ chối không thêm messages/runs/jobs; E15 không huỷ run.
  expect(await counts(sql)).toEqual(before);
  const [run] = await sql<
    { status: string }[]
  >`select status from hub.runs where id = ${R.runLive}`;
  expect(run?.status).toBe("running");
}

describe("A1 · token xấu / tenant, user khoá → 401 AUTH_EXPIRED [HUB-FR-01 · HUB-H1-AC-09]", () => {
  it("A1 · đối chứng: token hợp lệ của lan → E5 200, E7 200 [HUB-H1-AC-09]", async () => {
    const token = await sign(k, USERS.lan);
    expect((await call(hub, "GET", "/conversations", { token })).status).toBe(200);
    expect((await call(hub, "GET", `/conversations/${R.conv}`, { token })).status).toBe(200);
  });

  it("A1 · không có Authorization → 401 mọi endpoint [HUB-H1-AC-09]", async () => {
    await expect401Everywhere({});
  });

  it("A1 · token rác / Bearer rỗng 3 phần → 401 [HUB-H1-AC-09 · H1-R02]", async () => {
    await expect401Everywhere({ headers: { authorization: "Bearer rac.rac.rac" } });
    await expect401Everywhere({ headers: { authorization: "Bearer .." } });
  });

  it("A1 · token hết hạn → 401 [HUB-H1-AC-09 · H1-R02]", async () => {
    await expect401Everywhere({ token: await sign(k, USERS.lan, { expS: -60 }) });
  });

  it("A1 · token ký bằng khoá khác → 401 [HUB-H1-AC-09 · H1-R02]", async () => {
    await expect401Everywhere({ token: await sign(k, USERS.lan, { key: k.other }) });
  });

  it("A1 · aud/iss sai → 401 [HUB-H1-AC-09 · H1-R02]", async () => {
    await expect401Everywhere({ token: await sign(k, USERS.lan, { aud: "other-app" }) });
    await expect401Everywhere({ token: await sign(k, USERS.lan, { iss: "evil" }) });
  });

  it("A1 · role ngoài ROLES / thiếu tid → 401 [HUB-H1-AC-09 · H1-R02]", async () => {
    const L = USERS.lan;
    await expect401Everywhere({
      token: await sign(k, L, { claims: { tid: L.tid, role: "root" } }),
    });
    await expect401Everywhere({ token: await sign(k, L, { claims: { role: "member" } }) });
  });

  it("A1 · user locked_by_tenant (khoa) với token còn hạn → 401 [HUB-FR-88 · H1-R04]", async () => {
    await expect401Everywhere({ token: await sign(k, USERS.khoa) });
  });

  it("A1 · user active=false (nghi) với token còn hạn → 401 [HUB-FR-88 · H1-R04]", async () => {
    await expect401Everywhere({ token: await sign(k, USERS.nghi) });
  });

  it("A1 · tenant active=false (zeta/zed) với token còn hạn → 401 [HUB-FR-88 · H1-R04]", async () => {
    await expect401Everywhere({ token: await sign(k, USERS.zed) });
  });
});

/** E5 của `token`, chờ tới khi status = `want` (≤ 5 s, H1-R04). */
const e5Until = (token: string, want: number) =>
  waitFor(
    () => call(hub, "GET", "/conversations", { token }),
    (r) => r.status === want,
    5_000,
  );

describe("A2 · khoá giữa chừng → ≤ 5 s 401, mở lại → 200 [HUB-FR-88 · H1-R04]", () => {
  it("A2 · tenants.active=false + config_changed → ≤ 5 s 401; mở lại → 200 [HUB-FR-88 · H1-R04]", async () => {
    const token = await sign(k, USERS.gam);
    try {
      expect((await call(hub, "GET", "/conversations", { token })).status).toBe(200);
      await adminChange(
        sql,
        "tenant",
        T.gamma,
        (tx) => tx`update admin.tenants set active = false where id = ${T.gamma}`,
      );
      expect(errorOf(await e5Until(token, 401))).toEqual(err("AUTH_EXPIRED"));
      await adminChange(
        sql,
        "tenant",
        T.gamma,
        (tx) => tx`update admin.tenants set active = true where id = ${T.gamma}`,
      );
      expect((await e5Until(token, 200)).status).toBe(200);
    } finally {
      await sql`update admin.tenants set active = true where id = ${T.gamma}`;
    }
  }, 20_000);

  it("A2 · users.active=false + config_changed → ≤ 5 s 401; mở lại → 200 [HUB-FR-88 · H1-R04]", async () => {
    const token = await sign(k, USERS.tam);
    try {
      expect((await call(hub, "GET", "/conversations", { token })).status).toBe(200);
      await adminChange(
        sql,
        "user",
        T.acme,
        (tx) => tx`update admin.users set active = false where id = ${USERS.tam.id}`,
      );
      expect(errorOf(await e5Until(token, 401))).toEqual(err("AUTH_EXPIRED"));
      await adminChange(
        sql,
        "user",
        T.acme,
        (tx) => tx`update admin.users set active = true where id = ${USERS.tam.id}`,
      );
      expect((await e5Until(token, 200)).status).toBe(200);
    } finally {
      await sql`update admin.users set active = true where id = ${USERS.tam.id}`;
    }
  }, 20_000);

  it("A2 · users.locked_by_tenant=true + config_changed → ≤ 5 s 401; mở lại → 200 [HUB-FR-88 · H1-R04]", async () => {
    const token = await sign(k, USERS.tam);
    try {
      expect((await call(hub, "GET", "/conversations", { token })).status).toBe(200);
      await adminChange(
        sql,
        "user",
        T.acme,
        (tx) => tx`update admin.users set locked_by_tenant = true where id = ${USERS.tam.id}`,
      );
      expect(errorOf(await e5Until(token, 401))).toEqual(err("AUTH_EXPIRED"));
      await adminChange(
        sql,
        "user",
        T.acme,
        (tx) => tx`update admin.users set locked_by_tenant = false where id = ${USERS.tam.id}`,
      );
      expect((await e5Until(token, 200)).status).toBe(200);
    } finally {
      await sql`update admin.users set locked_by_tenant = false where id = ${USERS.tam.id}`;
    }
  }, 20_000);
});

describe("A3 · /health không cần token [HUB-H1-AC-31]", () => {
  it("A3 · không token → 200 HealthResponseSchema chat [HUB-H1-AC-31]", async () => {
    const res = await call(hub, "GET", "/health");
    expect(res.status).toBe(200);
    expect(HealthResponseSchema.safeParse(res.json).success).toBe(true);
  });

  it("A3 · Redis hỏng → 503 body lỗi chat [HUB-H1-AC-31]", async () => {
    const broken = await startHub(k, { redisUrl: "redis://localhost:1/15" });
    try {
      const res = await call(broken, "GET", "/health");
      expect(res.status).toBe(503);
      expect(errorOf(res).code).toBeDefined();
    } finally {
      await broken.stop();
    }
  });
});
