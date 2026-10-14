// HUB-BR-30 · HUB-FR-129 · HUB-FR-115 · PC2-R07 · PC2-R08 · PC2-R09 · PC2-R15 · P-c2 · plan §6.5, spec §6 (Hub gọi ra ngoài) ·
// test-plan P-c2 §4 G01–G10: lỗi provider (mock GitHub ép phản hồi) ⇒ "Cần người quyết" `apply_failed` + `error_code` đúng bảng;
// rate limit ngắn ⇒ thử lại 1 lần; 5xx ⇒ 1 + 3 lần; không theo redirect; thân > 1 MiB ⇒ lỗi; pr_url ngoài https/host ⇒ null; nguồn
// không khoá ⇒ no_credential, không gọi GitHub; không rò token (log Hub, DB, PR).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { captureAll } from "../H4b1/_h4b1";
import {
  type CtxPc2,
  decisionOf,
  expectNoToken,
  type Json,
  mkApply,
  needPc2,
  OWNER,
  oneApply,
  reportApply,
  settlePc2,
  stageView,
  startPc2,
  TOK,
  toApply,
  waitRunIn,
} from "./_support/pc2";

let c: CtxPc2;
beforeAll(async () => {
  c = await startPc2();
  if (!c.pc2) return;
  await mkApply(c, "pc2-g", "gh-priv");
  await mkApply(c, "pc2-gpub", "gh-pub");
}, 60_000);
afterEach(async () => {
  await settlePc2(c);
});
afterAll(async () => {
  await c?.stop();
});

/** Chạy tới Áp, báo pushed, chờ run kết thúc/cần quyết; trả hàng + decision. */
async function pushAndWait(
  key = "pc2-g",
  ms = 20_000,
): Promise<{ runId: string; row: Json; dec: Json; status: string }> {
  const a = await toApply(c, key);
  await reportApply(c, a.aj);
  const run = await waitRunIn(c, a.runId, ["done", "needs_decision"], ms);
  return {
    runId: a.runId,
    row: await oneApply(c.sql, a.runId),
    dec: await decisionOf(c.sql, a.runId),
    status: run.status,
  };
}
const failed = (code: string) => ({
  run: "needs_decision",
  reason: "apply_failed",
  options: ["add_attempt", "cancel"],
  status: "failed",
  code,
});
const shape = (r: { row: Json; dec: Json; status: string }) => ({
  run: r.status,
  reason: r.dec?.reason,
  options: r.dec?.options,
  status: r.row.status,
  code: r.row.error_code,
});

describe("G01–G04 · 401/403/404/429 [PC2-R09]", () => {
  it("HUB-BR-30 · PC2-R09 · G01 · GitHub 401 (khoá bị thu hồi) ⇒ apply_failed{auth}; detail ≤ 300, không token", async () => {
    needPc2(c);
    c.gh.reset({ tokens: ["khoa-khac"] });
    const r = await pushAndWait();
    expect(shape(r)).toEqual(failed("auth"));
    expect(String(r.row.detail ?? "").length).toBeLessThanOrEqual(300);
    expectNoToken("hàng apply", JSON.stringify(r.row));
    expect((await stageView(c, "A", r.runId, 1))?.apply?.error_code).toBe("auth");
  }, 45_000);
  it("HUB-BR-30 · PC2-R09 · G02 · 403 + x-ratelimit-remaining 0, reset sau ~1 s ⇒ chờ rồi thử lại 1 lần ⇒ PR mở, run done", async () => {
    needPc2(c);
    c.gh.queue("pulls.list", {
      status: 403,
      headers: {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(Math.ceil(Date.now() / 1000) + 1),
      },
      body: { message: "API rate limit exceeded" },
    });
    const r = await pushAndWait();
    expect([r.status, r.row.status]).toEqual(["done", "pr_opened"]);
    expect(c.gh.calls("pulls.list")).toHaveLength(2);
  }, 45_000);
  it("HUB-BR-30 · PC2-R09 · G03 · 429 retry-after 120 (> 60 s) ⇒ apply_failed{rate_limited} ngay, không thử lại", async () => {
    needPc2(c);
    c.gh.queue("pulls.list", {
      status: 429,
      headers: { "retry-after": "120" },
      body: { message: "slow down" },
    });
    const r = await pushAndWait();
    expect(shape(r)).toEqual(failed("rate_limited"));
    expect(c.gh.calls("pulls.list")).toHaveLength(1);
  }, 45_000);
  it("HUB-BR-30 · PC2-R09 · G04 · 404 (repo không thấy / không quyền) ⇒ apply_failed{auth} (không phân biệt)", async () => {
    needPc2(c);
    c.gh.queue("pulls.list", { status: 404, body: { message: "Not Found" } });
    expect(shape(await pushAndWait())).toEqual(failed("auth"));
  }, 45_000);
});

describe("G05–G07 · 5xx / 422 khác / không khoá [PC2-R09, plan §6.5]", () => {
  it("HUB-BR-30 · PC2-R09 · G05 · 5xx mọi lần ⇒ 1 + 3 lần thử (1/2/4 s) rồi apply_failed{provider_error}", async () => {
    needPc2(c);
    for (let i = 0; i < 6; i++)
      c.gh.queue("pulls.list", { status: 502, body: { message: "Bad Gateway" } });
    const r = await pushAndWait("pc2-g", 30_000);
    expect(shape(r)).toEqual(failed("provider_error"));
    expect(c.gh.calls("pulls.list")).toHaveLength(4);
  }, 60_000);
  it("HUB-BR-30 · PC2-R09 · G06 · tạo PR 422 khác 'already exists' ⇒ apply_failed{provider_error}", async () => {
    needPc2(c);
    c.gh.queue("pulls.create", {
      status: 422,
      body: {
        message: "Validation Failed",
        errors: [{ resource: "PullRequest", field: "base", code: "invalid" }],
      },
    });
    expect(shape(await pushAndWait())).toEqual(failed("provider_error"));
  }, 45_000);
  it("HUB-FR-129 · plan §6.5 · G07 · nguồn github không khoá + pr ⇒ apply_failed{no_credential}, KHÔNG gọi GitHub", async () => {
    needPc2(c);
    const r = await pushAndWait("pc2-gpub");
    expect(shape(r)).toEqual(failed("no_credential"));
    expect(c.gh.calls()).toHaveLength(0);
  }, 45_000);
});

describe("G08–G10 · hàng rào gọi ra ngoài [spec §6, PC2-R15]", () => {
  it("PC2-R15 · G08 · html_url không phải https://github.com ⇒ pr_url null + error_code provider_error; view không có URL độc", async () => {
    needPc2(c);
    c.gh.queue("pulls.create", {
      status: 201,
      body: {
        number: 5,
        node_id: "PR_evil",
        state: "open",
        html_url: "http://evil.example/pc2/pull/5",
        head: { ref: "x" },
        base: { ref: "main" },
      },
    });
    const r = await pushAndWait();
    expect([r.row.pr_url, r.row.error_code]).toEqual([null, "provider_error"]);
    const v = await c.call("A", "GET", `/process-runs/${r.runId}`);
    expect(v.text).not.toContain("evil.example");
  }, 45_000);
  it("spec §6 · G09 · GitHub trả 301 ⇒ Hub KHÔNG theo redirect (không gọi đích), không mở PR", async () => {
    needPc2(c);
    c.gh.queue("pulls.list", {
      status: 301,
      headers: { location: `${c.ghBase}/qc-redirect-target` },
      body: {},
    });
    const r = await pushAndWait();
    expect(c.gh.calls().filter((x) => x.path === "/qc-redirect-target")).toHaveLength(0);
    expect([r.status, r.row.status]).toEqual(["needs_decision", "failed"]);
  }, 45_000);
  it("spec §6 · G10 · thân phản hồi > 1 MiB ⇒ apply_failed{provider_error} (không đọc hết)", async () => {
    needPc2(c);
    c.gh.queue("pulls.list", { status: 200, raw: `[${" ".repeat(1_200_000)}]` });
    expect(shape(await pushAndWait())).toEqual(failed("provider_error"));
  }, 45_000);
});

describe("G11 · không rò token [PC2-R11, spec §6]", () => {
  it("HUB-BR-30 · G11 · luồng PR đầy đủ: token chỉ ở header Authorization tới GitHub; KHÔNG ở log Hub, hub.jobs, autofix_applies, review_tasks, outputs, PR", async () => {
    needPc2(c);
    const cap = captureAll();
    let runId = "";
    try {
      runId = (await pushAndWait()).runId;
    } finally {
      cap.restore();
    }
    expectNoToken("log Hub", cap.lines.join("\n"));
    const db = await c.sql`select (select json_agg(j) from hub.jobs j) as jobs,
      (select json_agg(a) from hub.autofix_applies a) as applies,
      (select json_agg(t) from hub.review_tasks t) as tasks,
      (select json_agg(o) from hub.process_outputs o) as outs`;
    expectNoToken("DB", JSON.stringify(db));
    const prs = c.gh.pulls().filter((p) => p.owner === OWNER);
    expectNoToken("PR", JSON.stringify(prs));
    expect(c.gh.calls().every((x) => x.auth === `Bearer ${TOK.acme}`)).toBe(true);
    expectNoToken("view", (await c.call("A", "GET", `/process-runs/${runId}`)).text);
  }, 45_000);
});
