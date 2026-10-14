// HUB-FR-129 · HUB-FR-128 · HUB-FR-130 · HUB-BR-34 · HUB-BR-38(b) · HUB-FR-68 · PC2-R02 · R03 · R07 · R11 · R13 · R14 · P-c2 · plan §1,
// §6.2, §6.4–§6.6 · test-plan P-c2 §4 F01–F11: Hub thật + Runtime giả + mock GitHub. Gate stage tự-sửa Đạt ⇒ stage Áp: audit
// `authorize_real_action`, job `source.apply` đúng contract (không token), PR qua mock (tìm → tạo; đã có ⇒ dùng lại; 422 exists ⇒
// tìm lại), auto-merge SQUASH (bật hỏng vẫn done), branch_only/local/no_changes, view `apply` + `apply_mode`/`apply_base`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  afStage,
  applyJobs,
  C1,
  type CtxPc2,
  DIFF,
  expectNoToken,
  ghUrl,
  HEAD,
  INPUT,
  internalGet,
  type Json,
  mkApply,
  needPc2,
  OWNER,
  oneApply,
  PA,
  passGate,
  reportApply,
  SEC,
  SECRET,
  settlePc2,
  stageView,
  startPc2,
  T,
  TOK,
  toApply,
  toGate,
  waitRunIn,
} from "./_support/pc2";

let c: CtxPc2;
beforeAll(async () => {
  c = await startPc2();
  if (!c.pc2) return;
  await mkApply(c, "pc2-f", "gh-priv");
  await mkApply(c, "pc2-fauto", "gh-auto");
  await mkApply(c, "pc2-fbranch", "gh-branch");
  await mkApply(c, "pc2-fgl", "gl-repo");
  await mkApply(c, "pc2-flocal", "local-app");
}, 60_000);
afterEach(async () => {
  await settlePc2(c);
});
afterAll(async () => {
  await c?.stop();
});

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const prHead = (runId: string) => `${OWNER}:ai/${runId}/fix`;

describe("F01–F02 · launch stage Áp [PC2-R03, HUB-BR-38(b)]", () => {
  it("HUB-FR-129 · HUB-BR-38 · PC2-R13 · F01 · gate Đạt ⇒ audit authorize_real_action (actor B) + job source.apply đúng contract: nguồn, pin, nhánh, chế độ pr, patch = diff vòng 1, lệnh, timeout 600; không token", async () => {
    needPc2(c);
    const a = await toApply(c, "pc2-f");
    const [af] = await c.sql<
      Json[]
    >`select diff_attachment_id from hub.autofix_results where process_run_id = ${a.runId}`;
    expect(a.aj.payload).toEqual({
      v: 1,
      type: "source.apply",
      job_id: a.aj.id,
      tenant_id: T.acme,
      process_run_id: a.runId,
      source: {
        source_id: c.src.priv,
        key: "gh-priv",
        url: ghUrl("app-repo"),
        branch: "main",
        has_credential: true,
      },
      pin_sha: C1,
      branch: `ai/${a.runId}/fix`,
      apply_mode: "pr",
      push_only: false,
      patch: {
        id: af?.diff_attachment_id,
        name: "fix-r1.diff.txt",
        mime: "text/plain",
        size: Buffer.byteLength(DIFF),
        sha256: sha256(DIFF),
      },
      install_cmd: "bun install",
      test_cmd: "bun test",
      write_allowlist: ["src/**"],
      timeout_s: 600,
    });
    const hub = await import("@ai/contracts/hub");
    expect((hub as Json).JobPayloadSchema.safeParse(a.aj.payload).success).toBe(true);
    expectNoToken("payload job Áp", JSON.stringify(a.aj.payload));
    const dl = await internalGet(c, a.aj.id, a.aj.token, a.aj.payload.patch.id);
    expect([dl.status, dl.text]).toEqual([200, DIFF]);
    const ids = [
      a.runId,
      a.aj.id,
      ...(await c.sql<Json[]>`select id from hub.stage_runs where process_run_id = ${a.runId}`).map(
        (r) => r.id,
      ),
    ];
    const audit = await c.sql<Json[]>`select actor_id, entity_id from hub.audit_log
      where action = 'authorize_real_action' and entity_id = any(${c.sql.array(ids, 2950)})`;
    expect(audit.map((x) => x.actor_id)).toEqual([PA.B.id]);
  }, 45_000);
  it("HUB-FR-68 · Q10 · PC2-R11 · F02 · resolve item nguồn có khoá mang credential_secret_id (chỉ id, không giá trị); stage Áp running khi job chạy", async () => {
    needPc2(c);
    const a = await toApply(c, "pc2-f");
    const res = await c.sql<Json[]>`select payload from hub.jobs where type = 'source.resolve'
      and payload->>'process_run_id' = ${a.runId}`;
    const item = res.flatMap((r) => r.payload.items as Json[]).find((i) => i.key === "gh-priv");
    expect(item?.config?.credential_secret_id).toBe(SEC.acme);
    expectNoToken("payload resolve", JSON.stringify(res));
    const [st] = await c.sql<
      Json[]
    >`select status from hub.stage_runs where process_run_id = ${a.runId} and stage_idx = 1`;
    expect(st?.status).toBe("running");
  }, 45_000);
});

describe("F03–F06 · mở PR qua GitHub [PC2-R07, PC2-R14, PC2-R15]", () => {
  it("HUB-FR-129 · PC2-R07 · PC2-R14 · F03 · pushed ⇒ Hub tìm PR (head owner:branch, open) rồi tạo (base main, draft false, tiêu đề + thân theo luật, header GitHub, Bearer khoá nguồn) ⇒ pr_opened #1, stage done, run done; view apply + apply_mode/apply_base", async () => {
    needPc2(c);
    const a = await toApply(c, "pc2-f");
    await reportApply(c, a.aj);
    await waitRunIn(c, a.runId, ["done"]);
    const [list] = c.gh.calls("pulls.list");
    expect({ path: list?.path, head: list?.query.head, state: list?.query.state }).toEqual({
      path: "/repos/pc2-test/app-repo/pulls",
      head: prHead(a.runId),
      state: "open",
    });
    const creates = c.gh.calls("pulls.create");
    expect(creates).toHaveLength(1);
    const cr = creates[0];
    const b = cr?.body as Json;
    expect({
      title: b?.title,
      head: String(b?.head).endsWith(`ai/${a.runId}/fix`),
      base: b?.base,
      draft: b?.draft,
      mcm: b?.maintainer_can_modify,
    }).toEqual({
      title: `[AI] Áp pc2-f · Sửa lỗi (${a.runId.slice(0, 8)})`,
      head: true,
      base: "main",
      draft: false,
      mcm: false,
    });
    const body = String(b?.body);
    for (const s of [
      "## Thay đổi",
      "Sửa dấu cộng ở src/tong.ts.",
      "## Test",
      "12 pass · 0 fail",
      `Tạo bởi AI System · run ${a.runId} · vòng 1`,
    ])
      expect({ s, has: body.includes(s) }).toEqual({ s, has: true });
    for (const s of [SECRET, "KHÔNG-VÀO-PR", INPUT, PA.B.id, ...Object.values(TOK)])
      expect({ s, has: body.includes(s) }).toEqual({ s, has: false });
    expect({
      auth: cr?.headers.authorization,
      accept: cr?.headers.accept,
      ver: cr?.headers["x-github-api-version"],
      ua: cr?.headers["user-agent"],
    }).toEqual({
      auth: `Bearer ${TOK.acme}`,
      accept: "application/vnd.github+json",
      ver: "2022-11-28",
      ua: "ai-system-hub",
    });
    expect(c.gh.calls("graphql")).toHaveLength(0);
    const row = await oneApply(c.sql, a.runId);
    expect({
      s: row.status,
      p: row.provider,
      n: row.pr_number,
      u: row.pr_url,
      am: row.auto_merge,
      e: row.error_code,
    }).toEqual({
      s: "pr_opened",
      p: "github",
      n: 1,
      u: "https://github.com/pc2-test/app-repo/pull/1",
      am: null,
      e: null,
    });
    const v = await stageView(c, "A", a.runId, 1);
    expect(v?.status).toBe("done");
    expect(v?.apply).toMatchObject({
      mode: "pr",
      status: "pr_opened",
      branch: `ai/${a.runId}/fix`,
      target_sha: C1,
      head_sha: HEAD,
      rebased: false,
      provider: "github",
      pr_number: 1,
      pr_url: "https://github.com/pc2-test/app-repo/pull/1",
      auto_merge: null,
      error_code: null,
      test_log_file: null,
    });
    expect((v?.outputs ?? []).length).toBeGreaterThanOrEqual(1);
    const v0 = (await stageView(c, "A", a.runId, 0))?.autofix;
    expect({ mode: v0?.apply_mode, base: v0?.apply_base }).toEqual({ mode: "pr", base: "main" });
    expectNoToken("view run", JSON.stringify(await c.call("A", "GET", `/process-runs/${a.runId}`)));
  }, 45_000);
  it("HUB-FR-129 · PC2-R07 · F04 · PR mở sẵn cho cùng nhánh ⇒ dùng lại (không tạo), pr_number = PR cũ", async () => {
    needPc2(c);
    const a = await toApply(c, "pc2-f");
    const pr = c.gh.seedPr({
      owner: OWNER,
      repo: "app-repo",
      head: `ai/${a.runId}/fix`,
      base: "main",
    });
    await reportApply(c, a.aj);
    await waitRunIn(c, a.runId, ["done"]);
    expect(c.gh.calls("pulls.create")).toHaveLength(0);
    expect((await oneApply(c.sql, a.runId)).pr_number).toBe(pr.number);
  }, 45_000);
  it("HUB-FR-129 · PC2-R07 · F05 · tạo trả 422 'already exists' (tìm lần đầu rỗng) ⇒ tìm lại, dùng PR đó; run done", async () => {
    needPc2(c);
    const a = await toApply(c, "pc2-f");
    const pr = c.gh.seedPr({
      owner: OWNER,
      repo: "app-repo",
      head: `ai/${a.runId}/fix`,
      base: "main",
    });
    c.gh.queue("pulls.list", { status: 200, body: [] });
    await reportApply(c, a.aj);
    await waitRunIn(c, a.runId, ["done"]);
    expect([c.gh.calls("pulls.list").length, c.gh.calls("pulls.create").length]).toEqual([2, 1]);
    const row = await oneApply(c.sql, a.runId);
    expect([row.status, row.pr_number]).toEqual(["pr_opened", pr.number]);
  }, 45_000);
  it("HUB-FR-129 · Q6 · PC2-R07 · F06 · auto_merge ⇒ graphql enablePullRequestAutoMerge (node_id PR, SQUASH) ⇒ auto_merge 'on'; bật hỏng ⇒ 'failed', PR vẫn mở, run vẫn done", async () => {
    needPc2(c);
    const a = await toApply(c, "pc2-fauto");
    await reportApply(c, a.aj);
    await waitRunIn(c, a.runId, ["done"]);
    const gq = c.gh.calls("graphql");
    expect(gq).toHaveLength(1);
    const text = JSON.stringify(gq[0]?.body);
    const node = c.gh.pulls()[0]?.node_id ?? "?";
    expect([
      text.includes("enablePullRequestAutoMerge"),
      text.includes("SQUASH"),
      text.includes(node),
    ]).toEqual([true, true, true]);
    expect((await oneApply(c.sql, a.runId)).auto_merge).toBe("on");
    expect((await stageView(c, "A", a.runId, 1))?.apply?.auto_merge).toBe("on");
    await settlePc2(c);
    const b = await toApply(c, "pc2-fauto");
    c.gh.queue("graphql", {
      status: 200,
      body: {
        data: null,
        errors: [
          {
            type: "UNPROCESSABLE",
            message: "Pull request is not in the correct state to enable auto-merge",
          },
        ],
      },
    });
    await reportApply(c, b.aj);
    await waitRunIn(c, b.runId, ["done"]);
    const row = await oneApply(c.sql, b.runId);
    expect([row.status, row.auto_merge, row.error_code]).toEqual(["pr_opened", "failed", null]);
  }, 60_000);
});

describe("F07–F11 · chế độ theo nguồn + không job [PC2-R02, PC2-R03, Q4]", () => {
  it("HUB-FR-129 · PC2-R02 · E5 · F07 · nguồn branch_only ⇒ job push_only; pushed ⇒ stage done (status pushed), KHÔNG gọi GitHub", async () => {
    needPc2(c);
    const a = await toApply(c, "pc2-fbranch");
    expect([a.aj.payload.apply_mode, a.aj.payload.push_only]).toEqual(["branch_only", true]);
    await reportApply(c, a.aj);
    await waitRunIn(c, a.runId, ["done"]);
    expect(c.gh.calls()).toHaveLength(0);
    const row = await oneApply(c.sql, a.runId);
    expect([row.status, row.mode, row.pr_number]).toEqual(["pushed", "branch_only", null]);
    expect((await stageView(c, "A", a.runId, 1))?.apply?.status).toBe("pushed");
  }, 45_000);
  it("HUB-FR-129 · PC2-R02 · Q1 · F08 · gitlab.com không khai chế độ ⇒ branch_only (push_only), has_credential false; gate view apply_mode branch_only, apply_base main", async () => {
    needPc2(c);
    const g = await toGate(c, "pc2-fgl");
    const v0 = (await stageView(c, "B", g.runId, 0))?.autofix;
    expect({ mode: v0?.apply_mode, base: v0?.apply_base }).toEqual({
      mode: "branch_only",
      base: "main",
    });
    await passGate(c, g);
    await waitRunIn(c, g.runId, ["running"]);
    const [j] = await applyJobs(c.sql, g.runId);
    expect([
      j?.payload?.apply_mode,
      j?.payload?.push_only,
      j?.payload?.source?.has_credential,
    ]).toEqual(["branch_only", true, false]);
  }, 45_000);
  it("HUB-FR-129 · PC2-R03 · Q4 · F09 · local_path ⇒ Áp không job: hàng branch_only (job null), stage done, run done; gate apply_mode branch_only, apply_base null; output có hướng dẫn git apply", async () => {
    needPc2(c);
    const g = await toGate(c, "pc2-flocal");
    const v0 = (await stageView(c, "B", g.runId, 0))?.autofix;
    expect({ mode: v0?.apply_mode, base: v0?.apply_base }).toEqual({
      mode: "branch_only",
      base: null,
    });
    await passGate(c, g);
    await waitRunIn(c, g.runId, ["done"]);
    expect(await applyJobs(c.sql, g.runId)).toHaveLength(0);
    const row = await oneApply(c.sql, g.runId);
    expect([row.status, row.mode, row.job_id, row.branch]).toEqual([
      "branch_only",
      "branch_only",
      null,
      null,
    ]);
    const v = await stageView(c, "A", g.runId, 1);
    expect(v?.apply?.status).toBe("branch_only");
    const out = (v?.outputs ?? [])[0];
    const md = await c.call("A", "GET", `/process-runs/${g.runId}/outputs/${out?.id}`);
    const text = String(md.json?.content ?? "");
    expect(text).toContain("## Kết quả áp");
    expect(text).toContain("git apply");
    expect(text).not.toContain("/qc-roots");
  }, 45_000);
  it("HUB-FR-129 · PC2-R03 · PC-R09 · F10 · tự-sửa no_changes ⇒ gate Đạt ⇒ Áp không job, hàng no_changes, run done", async () => {
    needPc2(c);
    const g = await toGate(c, "pc2-f", {
      report: { status: "no_changes", diff: null, diff_stats: null },
    });
    await passGate(c, g);
    await waitRunIn(c, g.runId, ["done"]);
    expect(await applyJobs(c.sql, g.runId)).toHaveLength(0);
    expect((await oneApply(c.sql, g.runId)).status).toBe("no_changes");
    expect(c.gh.calls()).toHaveLength(0);
  }, 45_000);
  it("HUB-FR-128 · C7 · F11 · def không có stage Áp ⇒ autofix.apply_mode null, apply_base null", async () => {
    needPc2(c);
    const r = await c.call("Adm", "POST", "/process-defs", {
      key: "pc2-fnoapply",
      name: "Không áp",
      description: "Chỉ tự sửa, không Áp.",
      input_hint: "Mô tả lỗi",
      run_group_ids: [],
      stages: [afStage({ source: "gh-priv" })],
      token_budget: null,
      enabled: true,
      sources: ["gh-priv"],
      inputs: [],
    });
    expect(r.status).toBe(201);
    const g = await toGate(c, "pc2-fnoapply");
    const v0 = (await stageView(c, "B", g.runId, 0))?.autofix;
    expect({ mode: v0?.apply_mode, base: v0?.apply_base }).toEqual({ mode: null, base: null });
  }, 45_000);
});
