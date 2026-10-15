// HUB-FR-126 · HUB-FR-130 · HUB-BR-34 · HUB-BR-14 · PC-R01 · PC-R02 · PC-R03 · P-c1 · plan §3.1, §6.1 · test-plan §3 V01–V09: lưu def
// có `autofix` qua `POST/PUT /process-defs` (Hub thật) — nguồn git_remote/local_path nhận, library ⇒ 422 PROCESS_REF_INVALID,
// 3 luật `AUTOFIX_*` ⇒ 422 PROCESS_DEF_INVALID (`paths`/`rules` cùng chỉ số), nguồn tenant khác ⇒ 422; seed mẫu `fixbug-apply`.
// Đỏ trước code: `autofix` là khoá lạ (strict) ⇒ 400 ở expect; `needPc` đỏ đầu ca.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { OWNER_URL } from "../H1/_fixtures";
import { fn, loadHubAdmin, loadSeed } from "../P-a/_support/modules";
import {
  afDefBody,
  afStage,
  type CtxPc,
  type Json,
  needPc,
  P1,
  postDef,
  startPc,
} from "./_support/pc";

let c: CtxPc;
beforeAll(async () => {
  c = await startPc();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

/** 422 PROCESS_DEF_INVALID ⇒ map path → rule (cùng chỉ số, plan P-b2 D10). */
function rulesOf(r: { status: number; json: Json }): Record<string, string> {
  expect({ status: r.status, code: r.json?.error?.code }).toEqual({
    status: 422,
    code: "PROCESS_DEF_INVALID",
  });
  const paths = (r.json?.error?.details?.paths ?? []) as string[];
  const rules = (r.json?.error?.details?.rules ?? []) as string[];
  return Object.fromEntries(paths.map((p, i) => [p, rules[i] ?? ""]));
}

describe("V01–V04 · nguồn của stage tự-sửa [PC-R01]", () => {
  it("HUB-FR-126 · PC-R01 · V01 · git_remote `app-repo` ⇒ 201; GET trả đúng autofix (install null, allowlist [])", async () => {
    needPc(c);
    const r = await postDef(c, afDefBody("pc-v01", [afStage({ test: "bun test src" })]));
    expect({ status: r.status, code: r.json?.error?.code }).toEqual({
      status: 201,
      code: undefined,
    });
    const g = await c.call("Adm", "GET", `/process-defs/${r.json.id}`);
    expect(g.json?.stages?.[0]?.autofix).toEqual({
      source_key: "app-repo",
      install_cmd: null,
      test_cmd: "bun test src",
      write_allowlist: [],
    });
  });
  it("HUB-FR-126 · Q3 · PC-R01 · V02 · local_path `local-app` ⇒ 201 (chỉ sửa bản sao)", async () => {
    needPc(c);
    const r = await postDef(
      c,
      afDefBody("pc-v02", [afStage({ source: "local-app" })], ["local-app"]),
    );
    expect(r.status).toBe(201);
  });
  it("HUB-FR-126 · PC-R01 · V03 · nguồn library ⇒ 422 PROCESS_REF_INVALID {path stages.0.autofix.source_key, ref source} (POST và PUT)", async () => {
    needPc(c);
    const bad = afDefBody("pc-v03", [afStage({ source: "docs-lib" })], ["docs-lib"]);
    const r = await postDef(c, bad);
    const want = {
      status: 422,
      code: "PROCESS_REF_INVALID",
      details: { path: "stages.0.autofix.source_key", ref: "source" },
    };
    expect({
      status: r.status,
      code: r.json?.error?.code,
      details: r.json?.error?.details,
    }).toEqual(want);
    const okr = await postDef(c, afDefBody("pc-v03b", [afStage()]));
    expect(okr.status).toBe(201);
    const put = await c.call("Adm", "PUT", `/process-defs/${okr.json.id}`, {
      ...bad,
      key: "pc-v03b",
      version: okr.json.version,
    });
    expect({
      status: put.status,
      code: put.json?.error?.code,
      details: put.json?.error?.details,
    }).toEqual(want);
  });
  it("HUB-BR-14 · PC-R14 · V04 · source_key ∉ def.sources ⇒ 422 nêu `stages.0.autofix.source_key`; tenant beta tham chiếu nguồn acme ⇒ 422", async () => {
    needPc(c);
    const r = await postDef(
      c,
      afDefBody("pc-v04", [afStage({ source: "other-repo" })], ["app-repo"]),
    );
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.json?.error?.details ?? {})).toContain("stages.0.autofix.source_key");
    const beta = await postDef(c, afDefBody("pc-v04b", [afStage({ agent: P1.agRead })]), "Db");
    expect({ status: beta.status }).toEqual({ status: 422 });
  });
});

describe("V05–V07 · luật AUTOFIX_* [PC-R02, HUB-BR-34]", () => {
  it("HUB-BR-34 · PC-R02 · V05 · after auto ⇒ AUTOFIX_REVIEW tại stages.0.after", async () => {
    needPc(c);
    const r = await postDef(c, afDefBody("pc-v05", [afStage({ after: "auto" })]));
    expect(rulesOf(r)["stages.0.after"]).toBe("AUTOFIX_REVIEW");
  });
  it("HUB-BR-34 · PC-R02 · V06 · executor team ⇒ AUTOFIX_EXECUTOR tại stages.0.executor", async () => {
    needPc(c);
    const r = await postDef(
      c,
      afDefBody("pc-v06", [afStage({ executor: { kind: "team", team_id: P1.teamQc } })]),
    );
    expect(rulesOf(r)["stages.0.executor"]).toBe("AUTOFIX_EXECUTOR");
  });
  it("HUB-FR-126 · PC-R02 · V07 · 2 stage tự-sửa ⇒ AUTOFIX_MAX tại stages.1.autofix (stage 0 không lỗi)", async () => {
    needPc(c);
    const r = await postDef(
      c,
      afDefBody("pc-v07", [afStage({ key: "fix-a" }), afStage({ key: "fix-b" })]),
    );
    const m = rulesOf(r);
    expect(m["stages.1.autofix"]).toBe("AUTOFIX_MAX");
    expect(Object.keys(m).some((p) => p.startsWith("stages.0."))).toBe(false);
  });
});

describe("V08–V09 · seed mẫu [PC-R03, HUB-FR-130]", () => {
  it("HUB-FR-130 · PC-R03 · D8 · V08 · seed ⇒ template `fixbug-apply` tắt sẵn, 1 stage tự-sửa (agent, review), hợp contract + autofixStageIssues = []; `fixbug-evolu` không autofix", async () => {
    needPc(c);
    const s = await loadSeed();
    await fn(
      s,
      "runHubSeed",
    )({ url: OWNER_URL, dir: s.DEFAULT_SEED_DIR, appEnv: "development", fixtures: true });
    const tpl = async (key: string): Promise<Json> =>
      (
        await c.sql<
          Json[]
        >`select * from hub.process_defs where tenant_id is null and key = ${key} and deleted_at is null`
      )[0];
    const apply = await tpl("fixbug-apply");
    expect({ has: apply !== undefined, enabled: apply?.enabled }).toEqual({
      has: true,
      enabled: false,
    });
    const stages = (apply?.stages ?? []) as Json[];
    const af = stages.filter((x) => x.autofix);
    expect(af.length).toBe(1);
    expect({ exec: af[0]?.executor?.kind, after: af[0]?.after?.kind }).toEqual({
      exec: "agent",
      after: "review",
    });
    expect((apply?.sources ?? []) as string[]).toContain(af[0]?.autofix?.source_key);
    const ha = await loadHubAdmin();
    for (const st of stages) expect(ha.ProcessStageDefSchema.safeParse(st).success).toBe(true);
    expect(fn(ha, "autofixStageIssues")(stages)).toEqual([]);
    const evolu = await tpl("fixbug-evolu");
    expect(evolu).toBeDefined();
    expect(((evolu?.stages ?? []) as Json[]).every((x) => !x.autofix)).toBe(true);
  });
  it("HUB-FR-130 · V09 · seed lần 2 không nhân đôi fixbug-apply", async () => {
    needPc(c);
    const s = await loadSeed();
    await fn(
      s,
      "runHubSeed",
    )({ url: OWNER_URL, dir: s.DEFAULT_SEED_DIR, appEnv: "development", fixtures: true });
    const [n] = await c.sql<{ n: number }[]>`select count(*)::int as n from hub.process_defs
      where tenant_id is null and key = 'fixbug-apply' and deleted_at is null`;
    expect(n?.n).toBe(1);
  });
});
