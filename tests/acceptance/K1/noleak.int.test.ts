// HUB-FR-137 · HUB-BR-30 · HUB-BR-36 · K1-AC03 · K1-AC09b (AC-H4b1-07 phần `work/<job_id>/`, H4b-1 Q12) · plan §8 "Không lộ" ·
// test-plan K1 §4 A110–A112: chạy trọn kịch bản (Kiểm tra kết nối, kh-query có 401 ⇒ làm mới, hạ cấp, ghi worklog) rồi quét:
// mọi response đã nhận, log Hub + console, `hub.audit_log`, MỌI bảng `hub.*` (owner, `x::text`), payload job, và thư mục
// `work/<job_id>/` dựng như Runtime (payload + prompt + mọi phản hồi `/mcp` của job — thứ duy nhất Hub giao cho job) —
// không chứa client_secret (`qc-K1-…-cs`) hay token KH đã cấp (`khfake_…`).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureAll, expectNoValue, type LogCap } from "../H4b1/_h4b1";
import { CS, type CtxK1, khWriteOnce, mdSum, NS, type Res, startK1, studio, T } from "./_k1";
import { done, khQuery, runToJob, toolsList, viewOf, waitStage } from "./_run";

let c: CtxK1;
let logs: LogCap;
const seen: string[] = [];
let jobDir = "";
const keep = (r: Res) => {
  seen.push(r.text);
  return r;
};

beforeAll(async () => {
  c = await startK1({ seed: "full" });
  logs = captureAll();
  if (!c.k1 || !c.sec) return;
  // 1) Kiểm tra kết nối (bước token + /v1/me + manifest) — Studio.
  keep(await studio(c, "POST", `/tenants/${T.acme}/check`));
  keep(await studio(c, "GET", "/tenants"));
  keep(await c.call("Adm", "GET", "/admin/kh"));
  // 2) Job stage dùng kh-query: 401 hết hạn ⇒ làm mới; rồi hạ cấp; rồi bình thường.
  const r = await runToJob(c, "k1-auto");
  const mcp: unknown[] = [await toolsList(c, r.token)];
  c.kh.set(NS.acme, { scenario: "token_expired_once" });
  mcp.push((await khQuery(c, r.token, { query: "q1" })).res.json);
  c.kh.set(NS.acme, { scenario: "embedder_unavailable" });
  mcp.push((await khQuery(c, r.token, { query: "q2" })).res.json);
  c.kh.set(NS.acme, { scenario: "ok" });
  mcp.push((await khQuery(c, r.token, { query: "q3" })).res.json);
  // 3) Ghi worklog.
  await done(c, r.job, mdSum());
  await waitStage(c.sql, r.runId, 0, "done");
  await khWriteOnce(c).catch(() => 0);
  keep(await viewOf(c, "A", r.runId));
  // 4) `work/<job_id>/` như Runtime dựng từ những gì Hub giao cho job.
  jobDir = join(tmpdir(), "qc-k1-work", r.job.id);
  mkdirSync(jobDir, { recursive: true });
  const [j] = await c.sql`select payload from hub.jobs where id = ${r.job.id}`;
  writeFileSync(join(jobDir, "payload.json"), JSON.stringify(j?.payload ?? r.job.payload));
  writeFileSync(
    join(jobDir, "prompt.md"),
    String((r.job.payload as { prompt?: string }).prompt ?? ""),
  );
  writeFileSync(join(jobDir, "mcp.jsonl"), mcp.map((x) => JSON.stringify(x)).join("\n"));
}, 120_000);
afterAll(async () => {
  logs?.restore();
  if (jobDir) rmSync(jobDir, { recursive: true, force: true });
  await c?.stop();
});

const need = () =>
  expect({ migration0029: c.k1, hubSecrets: c.sec }).toEqual({
    migration0029: true,
    hubSecrets: true,
  });
/** Chuỗi bị cấm: client_secret của mọi tenant + mọi token KH giả đã cấp + tiền tố token. */
const banned = () => [CS.acme, CS.beta, ...c.kh.tokens, "khfake_"];

describe("A110–A112 · không lộ credentials/token [K1-AC03 · K1-AC09b · HUB-BR-30]", () => {
  it("HUB-FR-137 · K1-AC03 · A110 · kịch bản có xin token (≥ 2 lần do 401) và KH nhận Bearer — điều kiện để quét có nghĩa", async () => {
    need();
    expect(c.kh.tokens.length).toBeGreaterThanOrEqual(2);
    expect(c.kh.calls.some((x) => x.path.endsWith("/context/step") && x.status === 200)).toBe(true);
  });
  it("HUB-BR-36 · K1-AC03 · A111 · response, log Hub + console, audit, mọi bảng hub.* (gồm payload job, kh_writes, kh_tenants.check_result) không chứa secret/token", async () => {
    need();
    expectNoValue(seen.join("\n"), banned());
    expect(logs.lines.length).toBeGreaterThan(0);
    expectNoValue(logs.lines.join("\n"), banned());
    const tables = await c.sql<
      { t: string }[]
    >`select table_name as t from information_schema.tables
      where table_schema = 'hub' and table_type = 'BASE TABLE' order by 1`;
    const hits: string[] = [];
    for (const { t } of tables)
      for (const v of banned()) {
        const [r] = await c.sql.unsafe(
          `select count(*)::int as n from hub."${t}" x where x::text like '%' || $1 || '%'`,
          [v],
        );
        if ((r?.n ?? 0) > 0) hits.push(`${t}:${v.slice(0, 12)}`);
      }
    expect(hits).toEqual([]);
  });
  it("HUB-BR-30 · K1-AC09b · AC-H4b1-07 · A112 · thư mục work/<job_id>/ (payload + prompt + phản hồi /mcp của job) không chứa secret/token", async () => {
    need();
    const files = readdirSync(jobDir);
    expect(files.sort()).toEqual(["mcp.jsonl", "payload.json", "prompt.md"]);
    const all = files.map((f) => readFileSync(join(jobDir, f), "utf8")).join("\n");
    expect(all.includes("Reference data from the knowledge base")).toBe(true);
    expectNoValue(all, banned());
  });
});
