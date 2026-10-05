// WRK-FR-11 · AC-H03 · H2c-R14, R15, R24 · HUB-H2c-AC-07 (vế Hub) · P9–P11 · PL4, PL9 · test-plan-int §2.8 A70–A79: tập file của
// run (`A`) tới job — Orchestrator: khối `<attachments>` ngay trước `<message>` (không `payload.attachments`); job agent (direct,
// delegate, resume): `payload.attachments = jobAttachments(A)` (khử trùng tên) + `prompt + "\n\n" + agentFilesBlock`; agent có
// `Write` ⇒ `system_prompt` + `OUT_HINT` (quá `SYSTEM_PROMPT_MAX` ⇒ bỏ + `warn`); MCP `hasFiles`. Không file ⇒ y hệt H2b.
// File "đã tải lên" = hàng SQL + nội dung trong `HUB_ATTACH_DIR`; Runtime = `ScriptRuntime` (claim SQL, XADD tay).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { AgentCliJobSchema } from "@ai/contracts/hub";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import { call, type Json, type Keys, makeKeys, type Sql, sign, USERS } from "../H1/_fixtures";
import { insertConv, insertFlow, runIdOf, type Sse, testRedis } from "../H1/_hub";
import { echoAnswer, type Job, ScriptRuntime } from "../H1/_runtime";
import { type Dify, startDify } from "../H2a/_h2a";
import { AG3, captureLogs, settleRuns } from "../H2b/_h2b";
import {
  type HubC,
  insertAttachmentRow,
  sample,
  sendWith,
  setupH2c,
  sha256,
  startHubH2c,
  userMessages,
} from "./_h2c";
import {
  agentBlock,
  briefOf,
  jobAttachmentOf,
  OUT_HINT,
  orchBlock,
  type StoredFile,
  SYSTEM_PROMPT_MAX,
  storedFile,
} from "./_h2c2";

let sql: Sql;
let k: Keys;
let hub: HubC;
let dify: Dify;
let redis: Redis;
let rt: ScriptRuntime;
let token = "";
const LONG_PROMPT = "S".repeat(SYSTEM_PROMPT_MAX - 10);

beforeAll(async () => {
  dify = startDify();
  sql = await setupH2c({ catalogBaseUrl: dify.baseUrl });
  // A79: 3 vòng Orchestrator + 2 delegate > max_steps 5 (H1); A74: `writer` có Write + system_prompt sát trần
  await sql`update hub.orchestrator_settings set max_steps = 10 where id = 1`;
  await sql`update hub.agents set system_prompt = ${LONG_PROMPT},
    runtime_options = ${sql.json({ allowed_tools: ["Read", "Grep", "Write"] })} where id = ${AG3.writer}`;
  k = await makeKeys();
  hub = await startHubH2c(k);
  redis = await testRedis();
  rt = new ScriptRuntime(sql, redis);
  token = await sign(k, USERS.lan);
}, 60_000);
afterEach(() => settleRuns(hub, sql, k));
afterAll(async () => {
  await hub?.stop();
  await dify?.close();
  redis?.disconnect();
  await sql?.end();
});

type Started = { s: Sse; runId: string; conv: string; flow: string };
async function start(
  content: string,
  ids?: string[],
  o: { conv?: string; flow?: string } = {},
): Promise<Started> {
  const conv = o.conv ?? (await insertConv(sql, "lan", crypto.randomUUID()));
  const s = await sendWith(hub, token, conv, content, ids, o.flow);
  expect(s.status).toBe(200);
  return { s, runId: runIdOf(s), conv, flow: s.headers.get("x-flow-id") ?? "" };
}
const file = (name: string, bytes = sample.pdf(3000), mime = "application/pdf") =>
  storedFile(sql, hub, name, bytes, { mime });
/** Job đầu của run; đóng run bằng câu trả lời (Orchestrator) / kết quả agent. */
async function firstJob(x: Started): Promise<Job> {
  return rt.next(x.runId);
}
async function close(x: Started, j: Job): Promise<void> {
  if (j.payload.agent.role === "orchestrator") await rt.decide(j, echoAnswer(j));
  else await rt.agent(j, { status: "done", text: "Xong." });
  await x.s.terminal(15_000);
  x.s.close();
}
const hasKey = (p: unknown, key: string) => key in (p as Record<string, unknown>);

describe("A70–A71 · Orchestrator thấy danh sách file [H2c-R15 · P11]", () => {
  it("WRK-FR-11 · A70 · tin có file → prompt Orchestrator có orchestratorFilesBlock(A) ngay trước <message> (sau </steps_left>); payload không attachments [H2c-R15 · HUB-H2c-AC-07]", async () => {
    const f = await file("hoadon.pdf");
    const x = await start("Xem giúp file đính kèm A70", [f.id]);
    const o = await firstJob(x);
    expect(o.payload.agent.role).toBe("orchestrator");
    expect(o.payload.prompt).toContain(`</steps_left>\n${orchBlock([briefOf(f)])}\n<message>`);
    expect(hasKey(o.payload, "attachments")).toBe(false);
    await close(x, o);
  });

  it("WRK-FR-11 · A71 · không file → prompt Orchestrator === H2b (</steps_left> liền <message>, không <attachments>; hai run tương tự cho cùng prompt) [H2c-R15 · P11]", async () => {
    const prompts: string[] = [];
    for (let i = 0; i < 2; i++) {
      const x = await start("Câu hỏi không file A71");
      const o = await firstJob(x);
      prompts.push(o.payload.prompt);
      await close(x, o);
    }
    expect(prompts[0]).toContain("</steps_left>\n<message>");
    expect(prompts[0]).not.toContain("<attachments>");
    expect(prompts[1]).toBe(prompts[0] as string);
  });
});

describe("A72–A76 · job agent mang file [H2c-R15 · H2c-R24 · PL9]", () => {
  it("WRK-FR-11 · A72 · @assistant x + 2 file → payload.attachments = jobAttachments(A) (id, name, mime, size, sha256 = cột), parse AgentCliJobSchema; prompt = 'x' + '\\n\\n' + agentFilesBlock [H2c-R15 · HUB-H2c-AC-07]", async () => {
    const a = await file("hoadon.pdf", sample.pdf(1500));
    const b = await file("ghi-chu.md", sample.md(300), "text/markdown");
    const x = await start("@assistant x", [a.id, b.id]);
    const j = await firstJob(x);
    expect(j.payload.agent.key).toBe("assistant");
    expect((j.payload as Json).attachments).toEqual([jobAttachmentOf(a), jobAttachmentOf(b)]);
    expect(AgentCliJobSchema.safeParse(j.payload).success).toBe(true);
    expect(j.payload.prompt).toBe(`x\n\n${agentBlock([briefOf(a), briefOf(b)])}`);
    await close(x, j);
  });

  it("WRK-FR-11 · A73 · trùng tên (a.pdf, A.pdf) → name a.pdf, A-2.pdf (jobFileNames, không phân biệt hoa) [H2c-R15 · R19]", async () => {
    const a = await file("a.pdf", sample.pdf(500));
    const b = await file("A.pdf", sample.pdf(600));
    const x = await start("@assistant hai file trùng tên", [a.id, b.id]);
    const j = await firstJob(x);
    const atts = ((j.payload as Json).attachments ?? []) as Json[];
    expect(atts.map((t) => [t.id, t.name])).toEqual([
      [a.id, "a.pdf"],
      [b.id, "A-2.pdf"],
    ]);
    await close(x, j);
  });

  it("WRK-FR-18 · A74 · agent hoadon (allowed_tools ∋ Write) → allowed_tools [Read, Grep, Write], system_prompt kết thúc OUT_HINT (cả khi không file); assistant → không Write, không OUT_HINT; Orchestrator không OUT_HINT; writer sát SYSTEM_PROMPT_MAX → giữ nguyên + warn attachment-out-hint-dropped{run_id, agent_id} [PL9 · P10 · H2c-R24]", async () => {
    const h = await start("@hoadon kiểm tra A74");
    const hj = await firstJob(h);
    expect(hj.payload.allowed_tools).toEqual(["Read", "Grep", "Write"]);
    expect(hj.payload.system_prompt.endsWith(OUT_HINT)).toBe(true);
    await close(h, hj);
    const a = await start("@assistant không Write A74");
    const aj = await firstJob(a);
    expect(aj.payload.allowed_tools).not.toContain("Write");
    expect(aj.payload.system_prompt).not.toContain(OUT_HINT);
    await close(a, aj);
    const o = await start("Câu thường A74");
    const oj = await firstJob(o);
    expect(oj.payload.agent.role).toBe("orchestrator");
    expect(oj.payload.system_prompt).not.toContain(OUT_HINT);
    await close(o, oj);
    const logs = captureLogs();
    let w: Started | undefined;
    let wj: Job | undefined;
    try {
      w = await start("@writer viết A74");
      wj = await firstJob(w);
    } finally {
      logs.restore();
    }
    if (!w || !wj) throw new Error("writer: không có job");
    expect(wj.payload.system_prompt).toBe(LONG_PROMPT);
    const dropped = logs.lines.filter((l) => l.rec.msg === "attachment-out-hint-dropped");
    expect(dropped.map((l) => [l.level, l.rec.run_id, l.rec.agent_id])).toEqual([
      ["warn", w.runId, AG3.writer],
    ]);
    await close(w, wj);
  });

  it("WRK-FR-11 · A75 · delegate (Orchestrator → delegate assistant) → job agent mang A + khối file như A72 (prompt = prompt delegate không file + '\\n\\n' + khối) [H2c-R15 · P9]", async () => {
    const task = "Đọc file đính kèm và tóm tắt A75";
    const prompts: string[] = [];
    const f = await file("bao-cao.pdf", sample.pdf(2100));
    for (const ids of [undefined, [f.id]]) {
      const x = await start("Nhờ trợ lý xem file A75", ids);
      const o = await firstJob(x);
      await rt.decide(o, { decision: "delegate", agent: "assistant", task });
      const a = await rt.next(x.runId);
      expect(a.payload.agent.key).toBe("assistant");
      prompts.push(a.payload.prompt);
      if (ids) expect((a.payload as Json).attachments).toEqual([jobAttachmentOf(f)]);
      else expect(hasKey(a.payload, "attachments")).toBe(false);
      await close(x, a);
    }
    expect(prompts[1]).toBe(`${prompts[0]}\n\n${agentBlock([briefOf(f)])}`);
  });

  it("WRK-FR-11 · A76 · không file → payload agent không khoá attachments, prompt === 'x' (H2b) [H2c-R24 · P11]", async () => {
    const x = await start("@assistant x");
    const j = await firstJob(x);
    expect(hasKey(j.payload, "attachments")).toBe(false);
    expect(j.payload.prompt).toBe("x");
    await close(x, j);
  });
});

describe("A77–A78 · resume, MCP theo file [H1-R23 · H2c-R23]", () => {
  it("WRK-FR-11 · A77 · resume: tin 1 (file gắn) → tin 2 cùng flow không file '@assistant tiếp' → job mới mang A của run 2 (file tin 1) [H2c-R14 · H1-R23]", async () => {
    const conv = await insertConv(sql, "lan", crypto.randomUUID());
    const flow = await insertFlow(sql, "lan", conv, crypto.randomUUID(), {
      msgs: [
        { role: "user", content: "tin 1 có file" },
        { role: "assistant", content: "đã xem" },
      ],
    });
    const [m] = await userMessages(sql, flow);
    const bytes = sample.pdf(1200);
    const r = await insertAttachmentRow(sql, {
      filename: "tin1.pdf",
      content: bytes,
      dir: hub.dir,
      bind: { messageId: m?.id ?? "", conversationId: conv, flowId: flow, position: 0 },
    });
    const f: StoredFile = {
      id: r.id,
      name: "tin1.pdf",
      mime: "application/pdf",
      size: bytes.length,
      sha256: sha256(bytes),
      content: bytes,
    };
    const x = await start("@assistant tiếp", undefined, { conv, flow });
    const j = await firstJob(x);
    expect((j.payload as Json).attachments).toEqual([jobAttachmentOf(f)]);
    expect(j.payload.prompt.endsWith(`\n\n${agentBlock([briefOf(f)])}`)).toBe(true);
    await close(x, j);
  });

  it("HUB-FR-50 · A78 · job agent hoadon có file → payload.mcp.tools ∋ hoadon-file (agentToolKeys hasFiles=true); không file → không có (đối chiếu A110/A114) [H2c-R23 · P12]", async () => {
    const f = await file("hoadon-a78.pdf");
    const withF = await start("@hoadon kiểm tra A78", [f.id]);
    const wj = await firstJob(withF);
    expect(wj.payload.mcp?.tools ?? []).toContain("hoadon-file");
    await close(withF, wj);
    const noF = await start("@hoadon không file A78");
    const nj = await firstJob(noF);
    expect(nj.payload.mcp?.tools ?? []).not.toContain("hoadon-file");
    await close(noF, nj);
  });
});

describe("A79 · AC-H03 chuỗi nhiều bước có file [L5]", () => {
  it("AC-H03 · A79 · lan tải hoadon.pdf, 'kiểm tra hoá đơn đính kèm rồi tạo thẻ Trello nếu sai': Orchestrator thấy file → delegate hoadon (job có attachments) → 'sai' → delegate trello (job cũng có A) → answer; step delegate(hoadon), delegate(trello); SSE step.started từng bước; tin user attachments=[hoadon.pdf] [HUB-H2c-AC-07 · L5]", async () => {
    const f = await file("hoadon.pdf", sample.pdf(4096));
    const x = await start("kiểm tra hoá đơn đính kèm rồi tạo thẻ Trello nếu sai", [f.id]);
    const o1 = await rt.next(x.runId);
    expect(o1.payload.prompt).toContain("- hoadon.pdf (application/pdf, 4 KB)");
    await rt.decide(o1, {
      decision: "delegate",
      agent: "hoadon",
      task: "Kiểm tra hoá đơn đính kèm",
    });
    const h = await rt.next(x.runId);
    expect(h.payload.agent.key).toBe("hoadon");
    expect((h.payload as Json).attachments).toEqual([jobAttachmentOf(f)]);
    // delegate đầu `done` + stream ⇒ trả thẳng (H2b-R19) — `partial` để Orchestrator đi tiếp (L5)
    await rt.agent(h, { status: "partial", text: "sai", missing: "tạo thẻ Trello" });
    const o2 = await rt.next(x.runId);
    await rt.decide(o2, {
      decision: "delegate",
      agent: "trello",
      task: "Tạo thẻ Trello: hoá đơn sai",
    });
    const t = await rt.next(x.runId);
    expect(t.payload.agent.key).toBe("trello");
    expect((t.payload as Json).attachments).toEqual([jobAttachmentOf(f)]);
    await rt.agent(t, { status: "done", text: "Đã tạo thẻ." });
    const o3 = await rt.next(x.runId);
    await rt.decide(o3, { decision: "answer", text: "Hoá đơn sai, đã tạo thẻ Trello." });
    expect((await x.s.terminal(20_000))?.event).toBe("run.finished");
    x.s.close();
    const steps = await sql<{ type: string; key: string | null }[]>`select s.type, a.key
      from hub.run_steps s left join hub.agents a on a.id = s.agent_id
      where s.run_id = ${x.runId} and s.type = 'delegate' order by s.seq`;
    expect(steps.map((s) => s.key)).toEqual(["hoadon", "trello"]);
    expect(x.s.events.filter((e) => e.event === "step.started").length).toBeGreaterThanOrEqual(2);
    const e11 = await call(hub, "GET", `/conversations/${x.conv}/messages?flow_id=${x.flow}`, {
      token,
    });
    const user = ((e11.json?.items ?? []) as Json[]).find((m) => m.role === "user");
    expect(user?.attachments?.map((a: Json) => a.filename)).toEqual(["hoadon.pdf"]);
  });
});
