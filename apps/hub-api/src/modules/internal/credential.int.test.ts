// WRK-FR-07 · HUB-FR-89 · H2a-R08, R17 · Q5 · B6 int: `POST /internal/jobs/:job_id/dify-credential` (route + service) trên DB
// test + role `hub_api` thật: 200 + `no-store`, 401 một body cho mọi sai, 409 `NOT_CONFIGURED` (secret hỏng, workflow ngoài
// catalog, vắng master key), không xét `workflows.enabled`, không log token/key.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  HUB_API_URL,
  insertFixture,
  ownerSql,
  prepareDb,
  type Sql,
} from "../../../../../tests/acceptance/H1/_fixtures";
import { AG, insertHubConfig } from "../../../../../tests/acceptance/H1/_hub";
import {
  corruptSecret,
  idGen2,
  insertCatalog,
  setAppKey,
  stored,
  TEST_MASTER_KEY_B64,
  WF,
} from "../../../../../tests/acceptance/H2a/_h2a";
import {
  insertSqlJob,
  newJobToken,
  type SqlJob,
} from "../../../../../tests/acceptance/H2a/_runtime2";
import { connectDb, type Db } from "../../lib/db";
import { logger, setSink } from "../../lib/logger";
import type { CatalogWorkflow } from "../commands/catalog.types";
import type { CatalogSnapshot } from "../config/catalog.rules";
import { CredentialService, loadMasterKey } from "../dify/credential.service";
import { credentialRoutes } from "./credential.routes";
import { bearerJobToken, DifyCredentialService } from "./credential.service";

const BASE_URL = "http://dify.test/v1";
let sql: Sql;
let db: Db;
const id = idGen2(9600);
const lines: string[] = [];
let restore: () => void = () => {};

const wf = (wid: string, enabled = true): CatalogWorkflow => ({
  id: wid,
  key: "k",
  name: "n",
  description: null,
  appType: "workflow",
  baseUrl: BASE_URL,
  secretId: null,
  inputSchema: [],
  outputField: null,
  enabled,
  sideEffect: false,
});
/** Catalog tối thiểu: `dich` + `tom` + `tat` (tắt); `hoi` vắng (ngoài catalog). */
const catalog = {
  workflows: new Map([
    [WF.dich, wf(WF.dich)],
    [WF.tom, wf(WF.tom)],
    [WF.tat, wf(WF.tat, false)],
  ]),
} as unknown as CatalogSnapshot;

function app(masterKey: string | undefined) {
  const credentials = new CredentialService({
    db,
    masterKey: loadMasterKey(masterKey),
    log: logger,
  });
  const svc = new DifyCredentialService({
    db,
    catalog: async () => catalog,
    credentials,
    log: logger,
  });
  return credentialRoutes(svc);
}
const post = (jobId: string, auth?: string, a = app(TEST_MASTER_KEY_B64)) =>
  a.request(`/jobs/${jobId}/dify-credential`, {
    method: "POST",
    headers: auth === undefined ? {} : { authorization: auth },
  });
const asyncJob = (workflowId: string, key: string, status?: "queued" | "succeeded") =>
  insertSqlJob(sql, id, { type: "workflow.async", workflowId, workflowKey: key, status });

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  await insertCatalog(sql, { baseUrl: BASE_URL, extras: true });
  db = connectDb(HUB_API_URL, 2);
  restore = setSink((_l, line) => lines.push(line));
}, 60_000);
afterAll(async () => {
  restore();
  await db?.close();
  await sql?.end();
});

describe("bearerJobToken", () => {
  it("chỉ nhận `Bearer <43 ký tự base64url>`", () => {
    const t = newJobToken();
    expect(bearerJobToken(`Bearer ${t}`)).toBe(t);
    expect(bearerJobToken(`bearer  ${t} `)).toBe(t);
    expect(bearerJobToken(undefined)).toBeNull();
    expect(bearerJobToken(t)).toBeNull();
    expect(bearerJobToken(`Basic ${t}`)).toBeNull();
    expect(bearerJobToken(`Bearer ${t}x`)).toBeNull();
    expect(bearerJobToken("Bearer abc")).toBeNull();
  });
});

describe("POST /internal/jobs/:job_id/dify-credential [Q5 · H2a-R17]", () => {
  it("200 {base_url, api_key, app_type} + no-store; log không token/key", async () => {
    await setAppKey(sql, "dich", "mk-ok");
    const j = await asyncJob(WF.dich, "dich");
    const from = lines.length;
    const res = await post(j.jobId, `Bearer ${j.token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      base_url: BASE_URL,
      api_key: stored("mk-ok"),
      app_type: "workflow",
    });
    const log = lines.slice(from).join("\n");
    expect(log).not.toContain(j.token);
    expect(log).not.toContain(stored("mk-ok"));
  });

  it("401 cùng body: thiếu/sai token, job khác, job không running, agent.cli", async () => {
    const a = await asyncJob(WF.dich, "dich");
    const b = await asyncJob(WF.dich, "dich");
    const queued = await asyncJob(WF.dich, "dich", "queued");
    const done = await asyncJob(WF.dich, "dich", "succeeded");
    const cli: SqlJob = await insertSqlJob(sql, id, {
      type: "agent.cli",
      agentId: AG.hoadon,
      agentKey: "hoadon",
    });
    const cases: [string, string | undefined][] = [
      [a.jobId, undefined],
      [a.jobId, `Bearer ${newJobToken()}`],
      [a.jobId, `Bearer ${b.token}`],
      ["not-a-uuid", `Bearer ${a.token}`],
      [queued.jobId, `Bearer ${queued.token}`],
      [done.jobId, `Bearer ${done.token}`],
      [cli.jobId, `Bearer ${cli.token}`],
    ];
    for (const [jobId, auth] of cases) {
      const res = await post(jobId, auth);
      expect({ jobId, status: res.status }).toEqual({ jobId, status: 401 });
      expect(await res.json()).toEqual({
        error: { code: "UNAUTHORIZED", message: "Unauthorized" },
      });
    }
  });
});

describe("POST /internal/jobs/:job_id/dify-credential — 409 [Q5 · H2a-R08]", () => {
  it("409 NOT_CONFIGURED: secret hỏng, workflow ngoài catalog, vắng master key; workflow tắt vẫn 200", async () => {
    const body = { error: { code: "NOT_CONFIGURED", message: "Not configured" } };
    try {
      await corruptSecret(sql, "tom");
      const j = await asyncJob(WF.tom, "tom");
      const r1 = await post(j.jobId, `Bearer ${j.token}`);
      expect(r1.status).toBe(409);
      expect(await r1.json()).toEqual(body);
    } finally {
      await setAppKey(sql, "tom", "mk-ok");
    }
    const outside = await asyncJob(WF.hoi, "hoi");
    const r2 = await post(outside.jobId, `Bearer ${outside.token}`);
    expect(r2.status).toBe(409);
    const d = await asyncJob(WF.dich, "dich");
    const r3 = await post(d.jobId, `Bearer ${d.token}`, app(undefined));
    expect(r3.status).toBe(409);
    expect(await r3.json()).toEqual(body);
    const off = await asyncJob(WF.tat, "tat");
    expect((await post(off.jobId, `Bearer ${off.token}`)).status).toBe(200);
  });
});
