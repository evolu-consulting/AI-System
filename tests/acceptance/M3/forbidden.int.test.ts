// ADM-NFR-07, ADM-BR-09 · mọi route M3: không token → 401; member → 403 FORBIDDEN (kiểm role TRƯỚC khi parse/tra, body 403
// giống byte); tenant_admin thực thể tenant khác → 404; route không có → 404 (M3-R06; test-plan I-X).
// Mỗi `it` tự dựng lại dữ liệu (beforeEach reset). Ca chỉ GET/lỗi nên không ghi, nhưng vẫn reset để độc lập.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { ErrorResponseSchema } from "@ai/contracts";
import {
  callerOf,
  createM3Env,
  expectErr,
  ID,
  ID3,
  type M3Env,
  TENANT_ID,
  USER_ID,
} from "./_fixtures";

let env: M3Env;
let admin: ReturnType<typeof callerOf>;
let binh: ReturnType<typeof callerOf>;
let hoa: ReturnType<typeof callerOf>;
let lan: ReturnType<typeof callerOf>;

beforeAll(async () => {
  env = await createM3Env();
  admin = callerOf(env, "platform", "admin");
  binh = callerOf(env, "acme", "binh");
  hoa = callerOf(env, "globex", "hoa");
  lan = callerOf(env, "acme", "lan");
});
beforeEach(async () => {
  await env.reset3();
});
afterAll(async () => {
  await env.close();
});

type Ids = { group: string; user: string; feature: string };
type Req = { name: string; method: string; path: string; body?: unknown };
const VALID: Ids = { group: ID3.group.acmeKeToan, user: USER_ID.lan, feature: ID.feature.keToan };
const UNKNOWN: Ids = { group: ID3.unknown, user: ID3.unknown, feature: ID3.unknown };
const ABC: Ids = { group: "abc", user: "abc", feature: "abc" };

/** 14 route M3; `bad` = body/query sai (member vẫn phải nhận 403 trước khi parse). */
function routes(i: Ids, bad: boolean): Req[] {
  const r = (name: string, method: string, path: string, body?: unknown): Req => ({
    name,
    method,
    path,
    body,
  });
  const junk = { sai: 1 };
  return [
    r("GET /admin/groups", "GET", bad ? "/admin/groups?limit=999" : "/admin/groups"),
    r(
      "POST /admin/groups",
      "POST",
      "/admin/groups",
      bad ? junk : { key: "moi-nhom", name: { vi: "Mới" } },
    ),
    r("GET /admin/groups/:id", "GET", `/admin/groups/${i.group}`),
    r(
      "PATCH /admin/groups/:id",
      "PATCH",
      `/admin/groups/${i.group}`,
      bad ? junk : { version: 1, name: { vi: "X" } },
    ),
    r("DELETE /admin/groups/:id", "DELETE", `/admin/groups/${i.group}`),
    r(
      "GET /admin/groups/:id/members",
      "GET",
      `/admin/groups/${i.group}/members${bad ? "?limit=999" : ""}`,
    ),
    r(
      "POST /admin/groups/:id/members",
      "POST",
      `/admin/groups/${i.group}/members`,
      bad ? junk : { usernames: ["an"] },
    ),
    r(
      "DELETE /admin/groups/:id/members/:user_id",
      "DELETE",
      `/admin/groups/${i.group}/members/${i.user}`,
    ),
    r("GET /admin/grants", "GET", bad ? "/admin/grants?limit=999" : "/admin/grants"),
    r(
      "POST /admin/grants",
      "POST",
      "/admin/grants",
      bad ? junk : { feature_id: i.feature, group_id: i.group },
    ),
    r(
      "DELETE /admin/grants",
      "DELETE",
      bad ? "/admin/grants?foo=1" : `/admin/grants?feature_id=${i.feature}&group_id=${i.group}`,
    ),
    r(
      "PUT /admin/grants/batch",
      "PUT",
      "/admin/grants/batch",
      bad ? junk : { add: [{ feature_id: i.feature, group_id: i.group }] },
    ),
    r(
      "GET /admin/grants/matrix",
      "GET",
      bad ? "/admin/grants/matrix?limit=999" : "/admin/grants/matrix",
    ),
    r(
      "GET /admin/users/:id/effective-access",
      "GET",
      `/admin/users/${i.user}/effective-access${bad ? "?command=a_b" : ""}`,
    ),
  ];
}
const ALL_VARIANTS: Array<[string, Req[]]> = [
  ["hợp lệ", routes(VALID, false)],
  ["body/query sai", routes(VALID, true)],
  ["id lạ", routes(UNKNOWN, false)],
  ["id 'abc'", routes(ABC, false)],
];
const call = (c: typeof admin, q: Req) => c(q.method, q.path, q.body);

describe("ADM-NFR-07 · không token → 401 (M3-R06)", () => {
  it("ADM-NFR-07 · M3-R06 · cả 14 route M3 không token → 401 UNAUTHORIZED", async () => {
    const bad: string[] = [];
    for (const q of routes(VALID, false)) {
      const res = await env.call(q.method, q.path, { body: q.body });
      if (res.status !== 401) bad.push(`${q.name}: ${res.status}`);
    }
    expect(bad).toEqual([]);
  });
});

describe("ADM-NFR-07 · member → 403 trước mọi lookup/parse (M3-R06)", () => {
  for (const [label, reqs] of ALL_VARIANTS) {
    it(`ADM-NFR-07 · M3-R06 · member + ${label}: cả 14 route → 403 FORBIDDEN`, async () => {
      const bad: string[] = [];
      for (const q of reqs) {
        const res = await call(lan, q);
        if (res.status !== 403 || res.json?.error?.code !== "FORBIDDEN")
          bad.push(`${q.name}: ${res.status}`);
      }
      expect(bad).toEqual([]);
    });
  }

  it("ADM-NFR-07 · M3-R06 · body 403 GIỐNG BYTE giữa các biến thể (hợp lệ / sai / id lạ / abc) của cùng một route", async () => {
    const bodies = new Map<string, Set<string>>();
    for (const [, reqs] of ALL_VARIANTS) {
      for (const q of reqs) {
        const res = await call(lan, q);
        const key = q.name;
        bodies.set(key, (bodies.get(key) ?? new Set()).add(res.text));
      }
    }
    const diverged = [...bodies].filter(([, set]) => set.size !== 1).map(([k]) => k);
    expect(diverged).toEqual([]);
  });

  it("ADM-NFR-07 · M3-R06 · phản hồi 403 parse ErrorResponseSchema, có X-Request-Id, message tĩnh", async () => {
    const res = await lan("GET", "/admin/groups");
    expectErr(res, "FORBIDDEN");
    const body = ErrorResponseSchema.parse(res.json);
    expect(body.error.message.length).toBeGreaterThan(0);
  });
});

describe("ADM-BR-09 · cách ly tenant và phạm vi role (M3-R06)", () => {
  it("ADM-BR-09 · M3-R06 · tenant_admin globex đụng thực thể acme qua path → 404 (không 403, không rò): groups, members, effective-access", async () => {
    const cases: Req[] = [
      { name: "GET group", method: "GET", path: `/admin/groups/${VALID.group}` },
      {
        name: "PATCH group",
        method: "PATCH",
        path: `/admin/groups/${VALID.group}`,
        body: { version: 1, name: { vi: "X" } },
      },
      { name: "DELETE group", method: "DELETE", path: `/admin/groups/${VALID.group}` },
      { name: "GET members", method: "GET", path: `/admin/groups/${VALID.group}/members` },
      {
        name: "POST members",
        method: "POST",
        path: `/admin/groups/${VALID.group}/members`,
        body: { usernames: ["an"] },
      },
      {
        name: "DELETE member",
        method: "DELETE",
        path: `/admin/groups/${VALID.group}/members/${VALID.user}`,
      },
      {
        name: "effective-access",
        method: "GET",
        path: `/admin/users/${USER_ID.lan}/effective-access`,
      },
    ];
    for (const q of cases) expectErr(await call(hoa, q), "NOT_FOUND");
  });

  it("ADM-BR-09 · M3-R06 · tenant_admin acme: route cùng tenant KHÔNG bị 403; platform_admin (kèm tenant_id khi ghi) cũng không 403/401", async () => {
    const forAcme = (q: Req) => ({
      ...q,
      path: `${q.path}${q.path.includes("?") ? "&" : "?"}tenant_id=${TENANT_ID.acme}`,
    });
    for (const q of routes(VALID, false)) {
      const a = await call(binh, q);
      const p = await call(admin, forAcme(q));
      expect([q.name, a.status === 403 || a.status === 401 || a.status >= 500]).toEqual([
        q.name,
        false,
      ]);
      expect([q.name, p.status === 403 || p.status === 401 || p.status >= 500]).toEqual([
        q.name,
        false,
      ]);
    }
  });

  it("ADM-FR-24 · M3-R14 · GET /admin/commands/:id/access vẫn CHỈ platform_admin: tenant_admin và member → 403", async () => {
    expectErr(await binh("GET", `/admin/commands/${ID.command.dich}/access`), "FORBIDDEN");
    expectErr(await lan("GET", `/admin/commands/${ID.command.dich}/access`), "FORBIDDEN");
    expect((await admin("GET", `/admin/commands/${ID.command.dich}/access`)).status).toBe(200);
  });
});

describe("ADM-FR-53 · không có route ngoài phạm vi M3", () => {
  it("ADM-FR-53 · M3 · GET /admin/config-version, POST /admin/features/:id/grants, GET /admin/commands/:id/effective → 404", async () => {
    expect((await admin("GET", "/admin/config-version")).status).toBe(404);
    expect((await admin("POST", `/admin/features/${ID.feature.keToan}/grants`, {})).status).toBe(
      404,
    );
    expect((await admin("GET", `/admin/commands/${ID.command.dich}/effective`)).status).toBe(404);
  });
});
