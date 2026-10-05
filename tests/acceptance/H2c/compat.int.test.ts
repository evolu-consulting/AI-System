// HUB-FR-44 · H2c-R30 · HUB-H2c-AC-16 · test-plan-int §2.15 A140–A142: tương thích — tin không `attachment_ids` giữ hình
// H2b (SSE, `run.started`, E10/E11, payload job); app dựng **không** `attachments` deps (khung H1/H2a/H2b): `/attachments`
// vẫn sau JWT (401 trước 404), E12 có ids vẫn kiểm/gắn (PL14); preview E10 có file → `attachments`, không file → không khoá.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { AttachmentRefSchema } from "@ai/contracts/chat";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import { call, type Json, type Keys, makeKeys, type Sql, sign, USERS } from "../H1/_fixtures";
import { insertConv, insertFlow, runIdOf, testRedis } from "../H1/_hub";
import { echoAnswer, ScriptRuntime } from "../H1/_runtime";
import { settleRuns } from "../H2b/_h2b";
import {
  attRow,
  codeOf,
  type HubC,
  insertAttachmentRow,
  sample,
  sendWith,
  setupH2c,
  startHubH2c,
  upload,
  userMessages,
} from "./_h2c";

let sql: Sql;
let k: Keys;
let hub: HubC;
let bare: HubC;
let redis: Redis;
let rt: ScriptRuntime;
let token = "";

beforeAll(async () => {
  sql = await setupH2c();
  k = await makeKeys();
  hub = await startHubH2c(k);
  bare = await startHubH2c(k, { attachments: false, extra: { instanceId: "qc-hub-h2c-bare" } });
  redis = await testRedis();
  rt = new ScriptRuntime(sql, redis);
  token = await sign(k, USERS.lan);
}, 60_000);
afterEach(async () => {
  await settleRuns(hub, sql, k);
  await settleRuns(bare, sql, k);
});
afterAll(async () => {
  await hub?.stop();
  await bare?.stop();
  redis?.disconnect();
  await sql?.end();
});

/** Tập khoá `Message` H2b của tin `orchestrated` (không `responder`, không `attachments`). */
const MESSAGE_KEYS = [
  "ask",
  "content",
  "conversation_id",
  "created_at",
  "flow_id",
  "id",
  "role",
  "run",
  "run_id",
];

describe("A140–A142 · tương thích H2b [H2c-R30 · HUB-H2c-AC-16]", () => {
  it("HUB-FR-44 · A140 · tin không attachment_ids: run.started {flow_id, quota, run_id}; payload job không khoá attachments; E11 cùng tập khoá H2b [H2c-R30 · AC-16]", async () => {
    const conv = await insertConv(sql, "lan", crypto.randomUUID());
    const s = await sendWith(hub, token, conv, "Xin chào A140");
    try {
      expect(s.status).toBe(200);
      const started = await s.until((e) => e.event === "run.started", 5_000);
      expect(Object.keys(started?.data ?? {}).sort()).toEqual(["flow_id", "quota", "run_id"]);
      const job = await rt.next(runIdOf(s));
      expect("attachments" in (job.payload as Json)).toBe(false);
      expect(job.payload.prompt).not.toContain("<attachments>");
      await rt.decide(job, echoAnswer(job));
      expect((await s.terminal(15_000))?.event).toBe("run.finished");
      const flowId = s.headers.get("x-flow-id") ?? "";
      const res = await call(hub, "GET", `/conversations/${conv}/messages?flow_id=${flowId}`, {
        token,
      });
      expect(res.status).toBe(200);
      for (const m of (res.json?.items ?? []) as Json[])
        expect(Object.keys(m).sort()).toEqual(MESSAGE_KEYS);
      const [run] = await sql<{ ids: string[] }[]>`select attachment_ids as ids from hub.runs
        where id = ${runIdOf(s)}`;
      expect(run?.ids).toEqual([]);
    } finally {
      s.close();
    }
  });

  it("HUB-FR-44 · A141 · app không attachments deps: POST /attachments có JWT → 404 NOT_FOUND, không JWT → 401 AUTH_EXPIRED; E12 không ids như H2b [PL14 · H2c-R30]", async () => {
    const pdf = sample.pdf(2048);
    expect(codeOf(await upload(bare, token, pdf, "a141.pdf"))).toEqual({
      status: 404,
      code: "NOT_FOUND",
    });
    expect(codeOf(await upload(bare, "", pdf, "a141.pdf"))).toEqual({
      status: 401,
      code: "AUTH_EXPIRED",
    });
    const conv = await insertConv(sql, "lan", crypto.randomUUID());
    const s = await sendWith(bare, token, conv, "Không file A141");
    try {
      expect(s.status).toBe(200);
    } finally {
      s.close();
    }
  });

  it("HUB-FR-44 · A141 · app không attachments deps: E12 có ids (hàng chèn SQL) vẫn kiểm (lạ → 404 ATTACHMENT_NOT_FOUND) và gắn (hợp lệ → message_id = tin user) [PL14]", async () => {
    const conv = await insertConv(sql, "lan", crypto.randomUUID());
    const ghost = crypto.randomUUID();
    const bad = await sendWith(bare, token, conv, "id lạ A141", [ghost]);
    bad.close();
    expect(codeOf(bad)).toEqual({ status: 404, code: "ATTACHMENT_NOT_FOUND" });
    const a = await insertAttachmentRow(sql, { who: "lan" });
    const s = await sendWith(bare, token, conv, "Có file A141", [a.id]);
    try {
      expect(s.status).toBe(200);
      const flowId = s.headers.get("x-flow-id") ?? "";
      const [m] = await userMessages(sql, flowId);
      const row = await attRow(sql, a.id);
      expect({ message: row.message_id, position: row.position }).toEqual({
        message: m?.id,
        position: 0,
      });
    } finally {
      s.close();
    }
  });

  it("HUB-FR-44 · A142 · preview E10 + E11: tin có file (gắn SQL) → attachments [AttachmentRef]; tin không file → không khoá attachments [H2c-R12 · C1]", async () => {
    const conv = await insertConv(sql, "lan", crypto.randomUUID());
    const withFile = await insertFlow(sql, "lan", conv, crypto.randomUUID(), {
      msgs: [
        { role: "user", content: "có file" },
        { role: "assistant", content: "đã xem" },
      ],
    });
    const plain = await insertFlow(sql, "lan", conv, crypto.randomUUID(), {
      msgs: [
        { role: "user", content: "không file" },
        { role: "assistant", content: "ok" },
      ],
    });
    const [u] = await userMessages(sql, withFile);
    const a = await insertAttachmentRow(sql, {
      filename: "hoadon-a142.pdf",
      size: 4096,
      bind: { messageId: u?.id ?? "", conversationId: conv, flowId: withFile, position: 0 },
    });
    const res = await call(hub, "GET", `/conversations/${conv}/flows`, { token });
    expect(res.status).toBe(200);
    const flows = (res.json?.items ?? []) as Json[];
    const fq = flows.find((f) => f.id === withFile)?.preview?.question;
    const pq = flows.find((f) => f.id === plain)?.preview;
    expect("attachments" in (pq?.question ?? {})).toBe(false);
    expect("attachments" in (pq?.answer ?? {})).toBe(false);
    expect(fq?.attachments).toEqual([
      {
        id: a.id,
        filename: "hoadon-a142.pdf",
        mime: "application/pdf",
        size: 4096,
        available: true,
      },
    ]);
    expect(AttachmentRefSchema.safeParse(fq?.attachments?.[0]).success).toBe(true);
    const msgs = await call(hub, "GET", `/conversations/${conv}/messages?flow_id=${withFile}`, {
      token,
    });
    const items = (msgs.json?.items ?? []) as Json[];
    expect(items.find((m) => m.role === "assistant")?.attachments).toBeUndefined();
    expect(items.find((m) => m.role === "user")?.attachments?.map((x: Json) => x.id)).toEqual([
      a.id,
    ]);
  });
});
