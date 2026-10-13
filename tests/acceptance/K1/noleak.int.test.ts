// HUB-BR-30 · HUB-BR-36 · HUB-BR-40 · K1-AC03 · K1-AC09b (AC-H4b1-07 phần `work/<job_id>/`, H4b-1 Q12) · CR-073 · spec §3.3
// ("Khoá KH không vào job/payload/prompt/log/audit"), plan D9 · test-plan K1 §4 A80–A82: chạy trọn kịch bản (Studio tạo kết
// nối + Kiểm tra + gắn agent, job có `kh-query` thành công + hạ cấp, ghi Tóm tắt) rồi quét: mọi response đã nhận, log Hub +
// console, `hub.audit_log`, MỌI bảng `hub.*` (owner, `x::text`), payload job, thư mục `work/<job_id>/` dựng như Runtime (payload +
// prompt + mọi phản hồi `/mcp` của job — thứ duy nhất Hub giao cho job) và thân lời gọi tới KH — không chứa giá trị khoá.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureAll, expectNoValue, type LogCap } from "../H4b1/_h4b1";
import {
  CONN,
  type CtxK1,
  K1,
  KEY,
  khWriteOnce,
  mdSum,
  needK1,
  P1,
  putAgentKh,
  type Res,
  startK1,
  studio,
} from "./_k1";
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
  c = await startK1({ seed: "secrets" });
  logs = captureAll();
  if (!c.k1 || !c.sec) return;
  // 1) Studio: tạo kết nối, khoá sai (kiểm lỗi), khoá đúng, kiểm tra, gắn agent.
  const cr = keep(
    await studio(c, "POST", "", {
      name: CONN.main,
      base_url: c.khA.base,
      secret_id: K1.secWrong,
      summary_project: "proj-a",
    }),
  );
  const id = cr.json?.id as string;
  keep(await studio(c, "POST", `/${id}/check`));
  keep(
    await studio(c, "PUT", `/${id}`, {
      name: CONN.main,
      base_url: c.khA.base,
      secret_id: K1.secMain,
      summary_project: "proj-a",
      version: 1,
    }),
  );
  keep(await studio(c, "POST", `/${id}/check`));
  keep(await studio(c, "GET", ""));
  const [a] = await c.sql<
    { v: number }[]
  >`select version as v from hub.agents where id = ${P1.agRead}`;
  keep(await putAgentKh(c, P1.agRead, { connection_ids: [id], version: a?.v ?? 1 }));
  // 2) Job stage: tools/list + kh-query ok + hạ cấp.
  const r = await runToJob(c, "k1-auto");
  const mcp: unknown[] = [await toolsList(c, r.token)];
  mcp.push((await khQuery(c, r.token, { query: "q1" })).res.json);
  c.khA.set({ scenario: "server_error" });
  mcp.push((await khQuery(c, r.token, { query: "q2" })).res.json);
  c.khA.set({ scenario: "ok" });
  // 3) Ghi Tóm tắt.
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

const banned = () => [KEY.a, KEY.b, KEY.wrong];

describe("A80–A82 · khoá KH không lộ [K1-AC03 · K1-AC09b · HUB-BR-30 · HUB-BR-36]", () => {
  it("HUB-BR-40 · K1-AC03 · A80 · kịch bản có nghĩa: KH nhận khoá qua X-KH-Key (cả khoá sai lẫn đúng), có /vector/query 200 và /vector/add; khoá chỉ ở header, không ở thân lời gọi", async () => {
    needK1(c);
    const calls = c.khA.calls;
    expect(calls.some((x) => x.sentKey && !x.keyOk)).toBe(true);
    expect(
      calls.some((x) => x.path === "/vector/query" && x.status === 200 && x.via === "x-kh-key"),
    ).toBe(true);
    expect(calls.some((x) => x.path === "/vector/add")).toBe(true);
    expectNoValue(JSON.stringify(calls.map((x) => x.body)), banned());
  });
  it("HUB-BR-36 · K1-AC03 · A81 · response, log Hub + console, audit, mọi bảng hub.* (gồm payload job, kh_jobs, kh_writes, kh_connections.check_result) không chứa giá trị khoá", async () => {
    needK1(c);
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
  it("HUB-BR-30 · K1-AC09b · AC-H4b1-07 · A82 · thư mục work/<job_id>/ (payload + prompt + phản hồi /mcp của job) không chứa giá trị khoá", async () => {
    needK1(c);
    const files = readdirSync(jobDir);
    expect(files.sort()).toEqual(["mcp.jsonl", "payload.json", "prompt.md"]);
    const all = files.map((f) => readFileSync(join(jobDir, f), "utf8")).join("\n");
    expect(all.includes("Reference data from the knowledge base")).toBe(true);
    expectNoValue(all, banned());
  });
});
