// HUB-BR-30 · HUB-FR-68 · HUB-BR-14 · ADR-0011 #4 · PC2-R11 · Q2 · P-c2 · plan §3.4, §6.3 · test-plan P-c2 §4 K01–K07:
// `POST /internal/jobs/:id/source-credential {source_id}` — chỉ job `running` loại `source.apply` (nguồn = payload.source) /
// `source.resolve` (nguồn ∈ items), cùng tenant, nguồn có khoá ⇒ 200 {username, token} no-store; sai mọi kiểu ⇒ 404 MỘT thân;
// token job sai ⇒ 401 một thân; khoá mất ⇒ 409 NOT_CONFIGURED; không log giá trị. Job dựng SQL (độc lập launcher B7).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { captureAll } from "../H4b1/_h4b1";
import { insertSource } from "../P-b/pfs1/_local";
import {
  type CtxPc2,
  expectNoToken,
  ghUrl,
  type Json,
  needPc2,
  newJobToken,
  PA,
  postCred,
  SEC,
  settlePc2,
  startPc2,
  T,
  TOK,
  tokenHash,
  Y,
} from "./_support/pc2";

let c: CtxPc2;
let lost = "";
beforeAll(async () => {
  c = await startPc2();
  if (!c.ready) return;
  lost = await insertSource(c.sql, {
    tenant: T.acme,
    key: "gh-lost",
    kind: "git_remote",
    config: {
      kind: "git_remote",
      url: ghUrl("lost-repo"),
      branch: "main",
      credential_secret_id: SEC.missing,
    },
  });
}, 60_000);
afterEach(async () => {
  await settlePc2(c);
});
afterAll(async () => {
  await c?.stop();
});

let seq = 0;
type SqlJob = { id: string; token: string };
/** Job dựng SQL (owner) như Hub tạo + Runtime claim: `status`, token job. */
async function sqlJob(o: {
  type: string;
  payload: Json;
  tenant?: string;
  status?: string;
}): Promise<SqlJob> {
  const id = Y(5000 + ++seq);
  const token = newJobToken();
  const tenant = o.tenant ?? T.acme;
  await c.sql`insert into hub.jobs (id, tenant_id, user_id, type, payload, status, token_hash, worker_id, started_at, heartbeat_at)
    values (${id}, ${tenant}, ${tenant === T.acme ? PA.A.id : PA.Db.id}, ${o.type},
      ${c.sql.json({ v: 1, type: o.type, job_id: id, tenant_id: tenant, ...o.payload })}, ${o.status ?? "running"},
      ${tokenHash(token)}, 'qc-rt-k', now(), now())`;
  return { id, token };
}
const src = (id: string, key: string, url = ghUrl("app-repo")) => ({
  source_id: id,
  key,
  url,
  branch: "main",
  has_credential: true,
});
const applyPayload = (s: Json) => ({
  process_run_id: Y(4999),
  source: s,
  pin_sha: "a".repeat(40),
  branch: `ai/${Y(4999)}/fix`,
  apply_mode: "pr",
  push_only: false,
});
const applyJobFor = (
  sourceId: string,
  key = "gh-priv",
  o: { tenant?: string; status?: string } = {},
) => sqlJob({ type: "source.apply", payload: applyPayload(src(sourceId, key)), ...o });

describe("K01–K02 · cấp khoá đúng job [PC2-R11]", () => {
  it("HUB-BR-30 · Q2 · K01 · job source.apply running + nguồn của job có khoá ⇒ 200 {username: x-access-token, token}; Cache-Control no-store; đúng 2 khoá", async () => {
    needPc2(c);
    const j = await applyJobFor(c.src.priv);
    const r = await postCred(c, j.id, j.token, { source_id: c.src.priv });
    expect({ status: r.status, body: r.json }).toEqual({
      status: 200,
      body: { username: "x-access-token", token: TOK.acme },
    });
    expect(r.headers.get("cache-control") ?? "").toContain("no-store");
  });
  it("HUB-FR-68 · Q10 · K02 · job source.resolve running có item nguồn khoá ⇒ 200 (repo riêng chỉ-đọc P-b); item khác của job không khoá ⇒ 404", async () => {
    needPc2(c);
    const item = (id: string, key: string, cred: string | null) => ({
      source_id: id,
      key,
      kind: "git_remote",
      config: { kind: "git_remote", url: ghUrl(key), branch: "main", credential_secret_id: cred },
      allowlist_union: ["**"],
    });
    const j = await sqlJob({
      type: "source.resolve",
      payload: {
        process_run_id: null,
        items: [item(c.src.pub, "gh-pub", null), item(c.src.priv, "gh-priv", SEC.acme)],
        timeout_s: 60,
      },
    });
    const ok = await postCred(c, j.id, j.token, { source_id: c.src.priv });
    expect({ status: ok.status, token: ok.json?.token }).toEqual({ status: 200, token: TOK.acme });
    expect((await postCred(c, j.id, j.token, { source_id: c.src.pub })).status).toBe(404);
  });
});

describe("K03–K06 · từ chối [PC2-R11, HUB-BR-14]", () => {
  it("HUB-BR-30 · K03 · không token / token rác / token của job khác ⇒ 401 cùng một thân, không lộ khoá", async () => {
    needPc2(c);
    const j = await applyJobFor(c.src.priv);
    const other = await applyJobFor(c.src.priv);
    const rs = [
      await postCred(c, j.id, null, { source_id: c.src.priv }),
      await postCred(c, j.id, "rac-khong-hop-le", { source_id: c.src.priv }),
      await postCred(c, j.id, other.token, { source_id: c.src.priv }),
    ];
    expect(rs.map((r) => r.status)).toEqual([401, 401, 401]);
    expect(new Set(rs.map((r) => r.text)).size).toBe(1);
    expectNoToken("401", rs.map((r) => r.text).join());
  });
  it("HUB-BR-14 · HUB-BR-30 · PC2-R11 · K04 · job không running / nguồn ngoài job / nguồn không khoá / nguồn tenant khác / job tenant khác / loại job khác ⇒ 404 MỘT thân", async () => {
    needPc2(c);
    const cases: [string, SqlJob, string][] = [
      ["queued", await applyJobFor(c.src.priv, "gh-priv", { status: "queued" }), c.src.priv],
      ["succeeded", await applyJobFor(c.src.priv, "gh-priv", { status: "succeeded" }), c.src.priv],
      ["ngoài job", await applyJobFor(c.src.priv), c.src.auto],
      ["không khoá", await applyJobFor(c.src.pub, "gh-pub"), c.src.pub],
      ["nguồn beta", await applyJobFor(c.src.betaPriv, "beta-priv"), c.src.betaPriv],
      ["job beta", await applyJobFor(c.src.priv, "gh-priv", { tenant: T.beta }), c.src.priv],
      [
        "workflow.async",
        await sqlJob({ type: "workflow.async", payload: { source: src(c.src.priv, "gh-priv") } }),
        c.src.priv,
      ],
    ];
    const texts: string[] = [];
    for (const [name, j, sid] of cases) {
      const r = await postCred(c, j.id, j.token, { source_id: sid });
      expect({ name, status: r.status, code: r.json?.error?.code }).toEqual({
        name,
        status: 404,
        code: "NOT_FOUND",
      });
      texts.push(r.text);
    }
    expect(new Set(texts).size).toBe(1);
    expectNoToken("404", texts.join());
  });
  it("HUB-BR-30 · K05 · nguồn trỏ khoá đã mất (secret không còn) ⇒ 409 NOT_CONFIGURED, không lộ id/giá trị khác", async () => {
    needPc2(c);
    const j = await applyJobFor(lost, "gh-lost");
    const r = await postCred(c, j.id, j.token, { source_id: lost });
    expect({ status: r.status, code: r.json?.error?.code }).toEqual({
      status: 409,
      code: "NOT_CONFIGURED",
    });
    expectNoToken("409", r.text);
  });
  it("HUB-BR-30 · K06 · thân sai (source_id không uuid / thiếu / thừa khoá) ⇒ 400 VALIDATION_ERROR", async () => {
    needPc2(c);
    const j = await applyJobFor(c.src.priv);
    for (const b of [{ source_id: "x" }, {}, { source_id: c.src.priv, tenant_id: T.acme }]) {
      const r = await postCred(c, j.id, j.token, b);
      expect({ b, status: r.status, code: r.json?.error?.code }).toEqual({
        b,
        status: 400,
        code: "VALIDATION_ERROR",
      });
    }
  });
});

describe("K07 · không rò khoá [PC2-R11, ADR-0011 #4]", () => {
  it("HUB-BR-30 · K07 · log Hub khi cấp khoá chỉ có {job_id, source_id}; payload/hàng job + audit_log không chứa giá trị khoá", async () => {
    needPc2(c);
    const cap = captureAll();
    let j: SqlJob;
    try {
      j = await applyJobFor(c.src.priv);
      expect((await postCred(c, j.id, j.token, { source_id: c.src.priv })).status).toBe(200);
      expect((await postCred(c, j.id, j.token, { source_id: c.src.auto })).status).toBe(404);
    } finally {
      cap.restore();
    }
    expectNoToken("log Hub", cap.lines.join("\n"));
    const jobs = await c.sql`select payload, result, error_message from hub.jobs`;
    const audit = await c.sql`select * from hub.audit_log`;
    expectNoToken("hub.jobs + audit_log", JSON.stringify([jobs, audit]));
  });
});
