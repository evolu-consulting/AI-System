// HUB-BR-34 · HUB-BR-38(b) · HUB-FR-129 · HUB-FR-130 · PC2-R01 · C5 · P-c2 · plan §3.2, §6.7 · test-plan P-c2 §4 V01–V06: lưu def có
// stage Áp (`executor.kind="apply"`) qua `POST /process-defs` (Hub thật) — 5 luật `APPLY_*` ⇒ 422 PROCESS_DEF_INVALID (`paths`/`rules`
// cùng chỉ số); seed mẫu MỚI `fixbug-pr` (tắt sẵn), `fixbug-apply` (P-c1) giữ nguyên. Đỏ trước code: executor `apply` lạ ⇒ 400.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { OWNER_URL } from "../H1/_fixtures";
import { fn, loadHubAdmin, loadSeed } from "../P-a/_support/modules";
import {
  afStage,
  applyDefBody,
  applyStage,
  type CtxPc2,
  type Json,
  needPc2,
  postDef,
  startPc2,
} from "./_support/pc2";

let c: CtxPc2;
beforeAll(async () => {
  c = await startPc2();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

/** 422 PROCESS_DEF_INVALID ⇒ map path → rule (cùng chỉ số). */
function rulesOf(r: { status: number; json: Json }): Record<string, string> {
  expect({ status: r.status, code: r.json?.error?.code }).toEqual({
    status: 422,
    code: "PROCESS_DEF_INVALID",
  });
  const paths = (r.json?.error?.details?.paths ?? []) as string[];
  const rules = (r.json?.error?.details?.rules ?? []) as string[];
  return Object.fromEntries(paths.map((p, i) => [p, rules[i] ?? ""]));
}
const fix = () => afStage({ source: "gh-priv", install: "bun install", allow: ["src/**"] });

describe("V01–V04 · lưu def có stage Áp [PC2-R01]", () => {
  it("HUB-FR-129 · C1 · V01 · tự-sửa (bước 0) + Áp (bước 1) ⇒ 201; GET giữ executor {kind:'apply'}, real_action, after auto", async () => {
    needPc2(c);
    const r = await postDef(c, applyDefBody("pc2-v01", "gh-priv"));
    expect({ status: r.status, err: r.json?.error?.code }).toEqual({ status: 201, err: undefined });
    const g = await c.call("Adm", "GET", `/process-defs/${r.json.id}`);
    const st = (g.json?.stages ?? [])[1] ?? {};
    expect({ ex: st.executor, real: st.real_action, after: st.after?.kind }).toEqual({
      ex: { kind: "apply" },
      real: true,
      after: "auto",
    });
  });
  it("HUB-BR-34 · PC2-R01 · V02 · Áp không đứng sau stage tự-sửa ⇒ APPLY_NO_AUTOFIX `stages.0.executor`", async () => {
    needPc2(c);
    const r = await postDef(c, applyDefBody("pc2-v02", "gh-priv", [applyStage()]));
    expect(rulesOf(r)["stages.0.executor"]).toBe("APPLY_NO_AUTOFIX");
  });
  it("HUB-BR-38 · PC2-R01 · V03 · real_action false ⇒ APPLY_REAL `stages.1.real_action`; after review ⇒ APPLY_AFTER `stages.1.after`", async () => {
    needPc2(c);
    const a = await postDef(
      c,
      applyDefBody("pc2-v03a", "gh-priv", [fix(), applyStage({ real_action: false })]),
    );
    expect(rulesOf(a)["stages.1.real_action"]).toBe("APPLY_REAL");
    const b = await postDef(
      c,
      applyDefBody("pc2-v03b", "gh-priv", [
        fix(),
        applyStage({ after: { kind: "review", group_id: null } }),
      ]),
    );
    expect(rulesOf(b)["stages.1.after"]).toBe("APPLY_AFTER");
  });
  it("HUB-BR-34 · PC2-R01 · V04 · Áp có nguồn ⇒ APPLY_FIELDS `stages.1`; 2 stage Áp ⇒ APPLY_MAX `stages.2.executor`", async () => {
    needPc2(c);
    const a = await postDef(
      c,
      applyDefBody("pc2-v04a", "gh-priv", [
        fix(),
        applyStage({ sources: [{ source_key: "gh-priv", allowlist: ["**"] }] }),
      ]),
    );
    expect(rulesOf(a)["stages.1"]).toBe("APPLY_FIELDS");
    const b = await postDef(
      c,
      applyDefBody("pc2-v04b", "gh-priv", [
        { ...fix(), step: 0 },
        applyStage({ step: 1 }),
        applyStage({ key: "apply-2", step: 1 }),
      ]),
    );
    expect(rulesOf(b)["stages.2.executor"]).toBe("APPLY_MAX");
  });
});

describe("V05–V06 · seed mẫu fixbug-pr [C5, HUB-FR-130]", () => {
  it("HUB-FR-129 · C5 · V05 · seed ⇒ template `fixbug-pr` tắt sẵn: stage 0 tự-sửa (agent, review) + stage 1 Áp (apply, real_action, auto, apply.md `## Kết quả áp`); hợp contract + applyStageIssues = []", async () => {
    needPc2(c);
    const s = await loadSeed();
    await fn(
      s,
      "runHubSeed",
    )({ url: OWNER_URL, dir: s.DEFAULT_SEED_DIR, appEnv: "development", fixtures: true });
    const [pr] = await c.sql<Json[]>`select * from hub.process_defs
      where tenant_id is null and key = 'fixbug-pr' and deleted_at is null`;
    expect({ has: pr !== undefined, enabled: pr?.enabled }).toEqual({ has: true, enabled: false });
    const st = (pr?.stages ?? []) as Json[];
    expect(st.map((x) => x.executor?.kind)).toEqual(["agent", "apply"]);
    expect({
      af: st[0]?.autofix !== null && st[0]?.autofix !== undefined,
      after0: st[0]?.after?.kind,
      real1: st[1]?.real_action,
      after1: st[1]?.after?.kind,
      out: st[1]?.output?.filename,
      sec: st[1]?.output?.required_sections,
      name: st[1]?.name,
    }).toEqual({
      af: true,
      after0: "review",
      real1: true,
      after1: "auto",
      out: "apply.md",
      sec: ["Kết quả áp"],
      name: "Áp bản sửa (PR)",
    });
    const ha = await loadHubAdmin();
    for (const x of st) expect(ha.ProcessStageDefSchema.safeParse(x).success).toBe(true);
    expect(fn(ha, "applyStageIssues")(st)).toEqual([]);
  });
  it("HUB-FR-130 · C5 · V06 · `fixbug-apply` (P-c1) không có stage Áp; seed lần 2 không nhân đôi fixbug-pr", async () => {
    needPc2(c);
    const s = await loadSeed();
    await fn(
      s,
      "runHubSeed",
    )({ url: OWNER_URL, dir: s.DEFAULT_SEED_DIR, appEnv: "development", fixtures: true });
    const [ap] = await c.sql<Json[]>`select stages from hub.process_defs
      where tenant_id is null and key = 'fixbug-apply' and deleted_at is null`;
    expect(((ap?.stages ?? []) as Json[]).some((x) => x.executor?.kind === "apply")).toBe(false);
    const [n] = await c.sql<{ n: number }[]>`select count(*)::int as n from hub.process_defs
      where tenant_id is null and key = 'fixbug-pr' and deleted_at is null`;
    expect(n?.n).toBe(1);
  });
});
