// HUB-FR-89 · HUB-FR-80 · HUB-H2a-AC-03 · HUB-H2a-AC-04 · H2a-R11, R15, R17 · P1, P2, P6 · B4 int: `credential.service`
// (hàm `hub.workflow_secret` dưới `hub_ro` + giải mã), `dify.usage` (`hub.log_dify_usage`), chuỗi credential → client →
// mock MK (proxy `_h2a.ts`) → usage, trên DB test + role `hub_api` thật. Secret mã bằng `encryptSecret` Admin (khoá test).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  HUB_API_URL,
  insertFixture,
  ownerSql,
  prepareDb,
  type Sql,
  T,
  USERS,
} from "../../../../../tests/acceptance/H1/_fixtures";
import { insertHubConfig } from "../../../../../tests/acceptance/H1/_hub";
import {
  corruptSecret,
  type Dify,
  idGen2,
  insertCatalog,
  leakForms,
  secretIdOf,
  setAppKey,
  startDify,
  stored,
  TEST_MASTER_KEY_B64,
  WF,
} from "../../../../../tests/acceptance/H2a/_h2a";
import { connectDb, type Db } from "../../lib/db";
import { type Logger, logger, setSink } from "../../lib/logger";
import { parseMasterKey } from "../../lib/secret-crypto";
import {
  CredentialService,
  isCredentialError,
  loadMasterKey,
  probeMasterKey,
  readWorkflowSecret,
} from "./credential.service";
import { DifyClient } from "./dify.client";
import type { DifyUsage } from "./dify.rules";
import { logDifyUsage, recordDifyUsage } from "./dify.usage";

let sql: Sql;
let db: Db;
let dify: Dify;
const id = idGen2(9400);
const lines: string[] = [];
let restore: () => void = () => {};
const key = parseMasterKey(TEST_MASTER_KEY_B64);
const OTHER_KEY_B64 = Buffer.alloc(32, 9).toString("base64");
const svc = (log: Logger = logger) => new CredentialService({ db, masterKey: key, log });

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  dify = startDify();
  await insertCatalog(sql, { baseUrl: dify.baseUrl });
  db = connectDb(HUB_API_URL, 2);
  restore = setSink((_l, line) => lines.push(line));
}, 60_000);
afterAll(async () => {
  restore();
  await db?.close();
  await dify?.close();
  await sql?.end();
});

const usageRow = (run: string, usage: DifyUsage, latencyMs: number, featureId: string | null) => ({
  tenantId: T.acme,
  runId: run,
  stepId: id(),
  userId: USERS.lan.id,
  featureId,
  agentId: null,
  usage,
  latencyMs,
});
const runDich = (apiKey: string) =>
  new DifyClient().runStreaming(
    {
      appType: "workflow",
      baseUrl: dify.baseUrl,
      apiKey,
      inputs: { source_text: "xin", target_lang: "en" },
      query: null,
      user: `acme:${USERS.lan.id}`,
      conversationId: null,
      outputField: "text",
    },
    new AbortController().signal,
    () => {},
  );

async function failureOf(p: Promise<unknown>): Promise<string> {
  return p.then(
    () => "ok",
    (e) => (isCredentialError(e) ? `${e.code}:${e.failure}` : `other:${String(e)}`),
  );
}

describe("HUB-FR-89 · credential.service [H2a-R17 · P1]", () => {
  it("HUB-FR-89 · workflow_secret dưới hub_ro + giải mã → app-key; workflow lạ → secret_missing", async () => {
    expect(await svc().apiKey(WF.dich)).toBe(stored("mk-ok"));
    const row = await readWorkflowSecret(db, WF.dich);
    expect(row?.secret_id).toBe(secretIdOf("dich"));
    expect(await failureOf(svc().apiKey(T.zeta))).toBe("NOT_CONFIGURED:secret_missing");
    const none = new CredentialService({ db, masterKey: null, log: logger });
    expect(await failureOf(none.apiKey(WF.dich))).toBe("NOT_CONFIGURED:master_key_missing");
  });

  it("HUB-H2a-AC-04 · bản mã hỏng / key_version lệch → NOT_CONFIGURED; log secret_decrypt_failed + workflow_id, không bản mã", async () => {
    try {
      for (const breakIt of [
        () => corruptSecret(sql, "tom"),
        () => sql`update admin.secrets set key_version = 2 where id = ${secretIdOf("tom")}`,
      ]) {
        await setAppKey(sql, "tom", "mk-ok");
        await breakIt();
        const [s] = await sql<{ hex: string }[]>`select encode(ciphertext, 'hex') as hex
          from admin.secrets where id = ${secretIdOf("tom")}`;
        const from = lines.length;
        expect(await failureOf(svc().apiKey(WF.tom))).toBe("NOT_CONFIGURED:secret_decrypt_failed");
        const mine = lines.slice(from);
        expect(mine.some((l) => l.includes("secret_decrypt_failed") && l.includes(WF.tom))).toBe(
          true,
        );
        for (const l of mine) expect(l).not.toContain(s?.hex ?? "∅");
      }
    } finally {
      await setAppKey(sql, "tom", "mk-ok");
    }
  });
});

describe("HUB-FR-89 · tự kiểm master key lúc khởi động [plan §8 · B-B4-3]", () => {
  it("HUB-FR-89 · khởi động: loadMasterKey tự kiểm, sai → ném không lộ giá trị; probe khớp/lệch khoá Admin", async () => {
    expect(loadMasterKey(undefined)).toBeNull();
    expect(loadMasterKey("")).toBeNull();
    expect(loadMasterKey(TEST_MASTER_KEY_B64)?.key).toEqual(key.key);
    let msg = "";
    try {
      loadMasterKey("not-a-key-value-123");
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).not.toBe("");
    expect(msg).not.toContain("not-a-key-value-123");
    expect(await probeMasterKey(db, key, logger)).toBe("ok");
    const other = loadMasterKey(OTHER_KEY_B64);
    if (!other) throw new Error("khoá thử phải nạp được");
    const from = lines.length;
    expect(await probeMasterKey(db, other, logger)).toBe("mismatch");
    expect(lines.slice(from).some((l) => l.includes("secret_master_key_mismatch"))).toBe(true);
  });
});

describe("HUB-FR-80 · dify.usage [H2a-R15 · P2]", () => {
  it("HUB-FR-80 · log_dify_usage: billing/provider dify, model null, feature/agent tuỳ chọn, số âm → 0", async () => {
    const run = id();
    const usage = { input_tokens: -5, output_tokens: 3, cost_usd: Number.NaN };
    await db.db.transaction((tx) => logDifyUsage(tx, usageRow(run, usage, 12.7, null)));
    const [u] = await sql`select billing, provider_key, model, feature_id, agent_id, input_tokens,
      output_tokens, cost_usd::text as cost, latency_ms from hub.usage_logs where run_id = ${run}`;
    expect(u).toMatchObject({
      billing: "dify",
      provider_key: "dify",
      model: null,
      feature_id: null,
      agent_id: null,
      input_tokens: 0,
      output_tokens: 3,
      latency_ms: 12,
    });
    expect(Number(u?.cost)).toBe(0);
  });
});

describe("HUB-H2a-AC-03 · credential → client → mock MK → usage [H2a-R15, R17]", () => {
  it("HUB-H2a-AC-03 · apiKey → DifyClient (mk-ok qua proxy) → finished; recordDifyUsage ghi token/cost Dify; key không vào DB", async () => {
    await setAppKey(sql, "dich", "mk-ok");
    dify.mock.reset();
    const apiKey = await svc().apiKey(WF.dich);
    const out = await runDich(apiKey);
    expect(out).toMatchObject({ kind: "finished", text: "Xin chào, đây là mock." });
    expect(dify.runs().map((c) => c.auth)).toEqual(["Bearer mk-ok"]);
    const run = id();
    await recordDifyUsage(db, usageRow(run, out.usage, out.ms, id()));
    const rows = await sql<{ i: number; o: number; c: string }[]>`select input_tokens as i,
      output_tokens as o, cost_usd::text as c from hub.usage_logs where run_id = ${run}`;
    expect(rows.map((r) => [r.i, r.o, Number(r.c)])).toEqual([[12, 8, 0.0001]]);
    const dump = JSON.stringify(await sql`select * from hub.usage_logs where run_id = ${run}`);
    for (const f of leakForms(apiKey)) expect(dump).not.toContain(f);
  });
});
