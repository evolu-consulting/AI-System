// HUB-FR-44 · HUB-FR-75 · H2c-R08–R12 · HUB-H2c-AC-05 · AC-06 · test-plan-int §2.5 A40–A52: E12 có `attachment_ids` —
// 400 hình dạng (C1), 404 `ATTACHMENT_NOT_FOUND{ids}` (khác tenant/khác user/không có/đã gắn/hết hạn/đã xoá, lẫn → chỉ id
// sai theo thứ tự gửi), gắn trong transaction (`message_id`, `bound_at`, `position`), rollback khi router từ chối, E10/E11
// `attachments` đúng thứ tự, thứ tự kiểm R10 (404 AF sau body, trước `CMD_*`/`AGENT_NOT_FOUND`/flow/`FLOW_BUSY`/429).
// File chèn bằng SQL (hàng chưa gắn, nội dung không cần) để ca chỉ phụ thuộc E12.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { AttachmentRefSchema } from "@ai/contracts/chat";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import {
  call,
  type Json,
  type Keys,
  makeKeys,
  type Sql,
  sign,
  USERS,
  type UserKey,
} from "../H1/_fixtures";
import { insertConv, insertFlow, runIdOf, testRedis } from "../H1/_hub";
import { echoAnswer, ScriptRuntime } from "../H1/_runtime";
import { type Dify, startDify } from "../H2a/_h2a";
import { settleRuns } from "../H2b/_h2b";
import {
  attRow,
  codeOf,
  countsH2c,
  DAY_MS,
  expectAttachNotFound,
  type HubC,
  insertAttachmentRow,
  sendWith,
  setupH2c,
  startHubH2c,
  userMessages,
} from "./_h2c";

let sql: Sql;
let k: Keys;
let hub: HubC;
let dify: Dify;
let redis: Redis;
let rt: ScriptRuntime;
const tok: Partial<Record<UserKey, string>> = {};

beforeAll(async () => {
  dify = startDify();
  sql = await setupH2c({ catalogBaseUrl: dify.baseUrl });
  k = await makeKeys();
  hub = await startHubH2c(k);
  redis = await testRedis();
  rt = new ScriptRuntime(sql, redis);
  for (const u of ["lan", "hoa", "an"] as const) tok[u] = await sign(k, USERS[u]);
}, 60_000);
afterEach(() => settleRuns(hub, sql, k));
afterAll(async () => {
  await hub?.stop();
  await dify?.close();
  redis?.disconnect();
  await sql?.end();
});

type Sent = { status: number; json: Json; runId: string; flowId: string };
/** E12 rồi đóng SSE ngay (run để `settleRuns` dọn). */
async function post(
  content: string,
  ids?: unknown,
  o: { who?: UserKey; conv?: string; flowId?: string } = {},
): Promise<Sent> {
  const who = o.who ?? "lan";
  const conv = o.conv ?? (await insertConv(sql, who, crypto.randomUUID()));
  const s = await sendWith(hub, tok[who] ?? "", conv, content, ids, o.flowId);
  s.close();
  return {
    status: s.status,
    json: s.json,
    runId: runIdOf(s),
    flowId: s.headers.get("x-flow-id") ?? "",
  };
}
const fresh = (o: Parameters<typeof insertAttachmentRow>[1] = {}) =>
  insertAttachmentRow(sql, o).then((r) => r.id);
/** Hàng đã gắn đúng tin user đầu của flow (message_id, bound_at, conversation/flow, position). */
async function expectBound(id: string, flowId: string, position: number): Promise<void> {
  const [m] = await userMessages(sql, flowId);
  const r = await attRow(sql, id);
  expect({
    message: r?.message_id,
    bound: r?.bound_at instanceof Date,
    flow: r?.flow_id,
    position: r?.position,
  }).toEqual({ message: m?.id, bound: true, flow: flowId, position });
  const [f] = await sql<{ conversation_id: string }[]>`select conversation_id from hub.flows
    where id = ${flowId}`;
  expect(r?.conversation_id).toBe(f?.conversation_id);
}
const unbound = async (id: string) => (await attRow(sql, id))?.message_id === null;

describe("A40–A43 · kiểm ids [H2c-R08 · R09 · AC-05]", () => {
  it("HUB-FR-44 · A40 · attachment_ids 11 / trùng / [] / 'x' → 400 VALIDATION_ERROR; có ids thiếu content → 400; 0 ghi [H2c-R08]", async () => {
    const conv = await insertConv(sql, "lan", crypto.randomUUID());
    const id = await fresh();
    const c0 = await countsH2c(sql);
    const many = Array.from({ length: 11 }, () => crypto.randomUUID());
    for (const ids of [many, [id, id], [], ["x"]]) {
      const r = await post("Có file", ids, { conv });
      expect({ ids, ...codeOf(r) }).toEqual({ ids, status: 400, code: "VALIDATION_ERROR" });
    }
    const s = await sendWith(hub, tok.lan ?? "", conv, "", [id]);
    s.close();
    expect(codeOf(s)).toEqual({ status: 400, code: "VALIDATION_ERROR" });
    const noContent = await call(hub, "POST", `/conversations/${conv}/messages`, {
      token: tok.lan,
      body: { attachment_ids: [id] },
    });
    expect(codeOf(noContent)).toEqual({ status: 400, code: "VALIDATION_ERROR" });
    expect(await countsH2c(sql)).toEqual(c0);
  });

  it("HUB-FR-44 · A41 · 1 id và 10 id hợp lệ → 200 SSE, mọi id gắn vào tin user theo position [H2c-R08 · R11]", async () => {
    const one = await fresh();
    const r1 = await post("Một file A41", [one]);
    expect(r1.status).toBe(200);
    await expectBound(one, r1.flowId, 0);
    const ten = await Promise.all(Array.from({ length: 10 }, () => fresh()));
    const r10 = await post("Mười file A41", ten);
    expect(r10.status).toBe(200);
    for (const [i, id] of ten.entries()) await expectBound(id, r10.flowId, i);
  });

  it("HUB-FR-75 · A42 · id acme gửi bởi an / id của hoa gửi bởi lan / không tồn tại / đã gắn / hết hạn (24 h + 1 s) / purged_at → mỗi ca 404 AF ids=[id], thân giống nhau trừ ids; 0 run/message/job [AC-05 · H2c-R09]", async () => {
    const lanFile = await fresh();
    const hoaFile = await fresh({ who: "hoa" });
    const conv = await insertConv(sql, "lan", crypto.randomUUID());
    const flow = await insertFlow(sql, "lan", conv, crypto.randomUUID(), {
      msgs: [{ role: "user", content: "cũ" }],
    });
    const [m] = await userMessages(sql, flow);
    const bound = await fresh({
      bind: { messageId: m?.id ?? "", conversationId: conv, flowId: flow, position: 0 },
    });
    const expired = await fresh({ createdAgoMs: DAY_MS + 1_000 });
    const purged = await fresh({ purged: true });
    const cases: [string, string, UserKey][] = [
      ["acme bởi an", lanFile, "an"],
      ["của hoa bởi lan", hoaFile, "lan"],
      ["không tồn tại", crypto.randomUUID(), "lan"],
      ["đã gắn", bound, "lan"],
      ["hết hạn", expired, "lan"],
      ["purged_at", purged, "lan"],
    ];
    const bodies: Json[] = [];
    for (const [name, id, who] of cases) {
      const c0 = await countsH2c(sql);
      const r = await post(`Gửi ${name}`, [id], { who });
      expect({ name, ...codeOf(r) }).toEqual({ name, status: 404, code: "ATTACHMENT_NOT_FOUND" });
      expectAttachNotFound(r, [id]);
      expect({ name, counts: await countsH2c(sql) }).toEqual({ name, counts: c0 });
      const { details: _d, ...rest } = r.json?.error ?? {};
      bodies.push(rest);
    }
    for (const b of bodies) expect(b).toEqual(bodies[0]);
  });

  it("HUB-FR-44 · A43 · lẫn [ok1, bad1, ok2, bad2] → 404 AF ids=[bad1, bad2] (thứ tự gửi); 0 ghi; ok1 gắn được sau đó [H2c-R09]", async () => {
    const [ok1, ok2] = [await fresh(), await fresh()];
    const [bad1, bad2] = [crypto.randomUUID(), await fresh({ who: "hoa" })];
    const c0 = await countsH2c(sql);
    const r = await post("Lẫn A43", [ok1, bad1, ok2, bad2]);
    expectAttachNotFound(r, [bad1, bad2]);
    expect(await countsH2c(sql)).toEqual(c0);
    expect(await unbound(ok1)).toBe(true);
    const again = await post("Lại A43", [ok1]);
    expect(again.status).toBe(200);
    await expectBound(ok1, again.flowId, 0);
  });
});

describe("A44–A49 · gắn, rollback, hiển thị [H2c-R11 · R12 · AC-06]", () => {
  it("HUB-FR-44 · A44 · [b, a] (b tải sau) → message_id = tin user, bound_at, conversation_id, flow_id; position b=0, a=1 [AC-06 · H2c-R11]", async () => {
    const a = await fresh({ createdAgoMs: 60_000 });
    const b = await fresh();
    const r = await post("Hai file A44", [b, a]);
    expect(r.status).toBe(200);
    await expectBound(b, r.flowId, 0);
    await expectBound(a, r.flowId, 1);
  });

  it("HUB-FR-44 · A45 · dùng lại id đã gắn (qua E12 trước) ở tin mới → 404 AF [AC-06]", async () => {
    const a = await fresh();
    const first = await post("Lần 1 A45", [a]);
    expect(first.status).toBe(200);
    await expectBound(a, first.flowId, 0);
    expectAttachNotFound(await post("Lần 2 A45", [a]), [a]);
  });

  it("HUB-FR-44 · A46 · ids hợp lệ nhưng router trả CMD_NOT_FOUND / FLOW_BUSY / TOO_MANY_RUNS → file vẫn chưa gắn; gửi lại (tin thường) → gắn [H2c-R11]", async () => {
    const a = await fresh();
    expect(codeOf(await post("/khong-co x", [a]))).toEqual({ status: 404, code: "CMD_NOT_FOUND" });
    expect(await unbound(a)).toBe(true);
    const busy = await post("Đang chạy A46");
    expect(busy.status).toBe(200);
    const conv = (
      await sql<{ conversation_id: string }[]>`select conversation_id from hub.flows
      where id = ${busy.flowId}`
    )[0]?.conversation_id;
    expect(codeOf(await post("Tiếp A46", [a], { conv, flowId: busy.flowId }))).toEqual({
      status: 409,
      code: "FLOW_BUSY",
    });
    expect(await unbound(a)).toBe(true);
    await post("Thêm A46");
    expect(codeOf(await post("Thứ ba A46", [a]))).toEqual({ status: 429, code: "TOO_MANY_RUNS" });
    expect(await unbound(a)).toBe(true);
    await settleRuns(hub, sql, k);
    const ok = await post("Gửi lại A46", [a]);
    expect(ok.status).toBe(200);
    await expectBound(a, ok.flowId, 0);
  });

  it("HUB-FR-44 · A47 · run xong: E11 + E10 tin user attachments = [b, a] (AttachmentRef strict, available:true); tin assistant không output → không khoá attachments [H2c-R12 · AC-06]", async () => {
    const a = await fresh({ filename: "a-A47.pdf", createdAgoMs: 60_000 });
    const b = await fresh({ filename: "b-A47.pdf" });
    const conv = await insertConv(sql, "lan", crypto.randomUUID());
    const s = await sendWith(hub, tok.lan ?? "", conv, "Hai file A47", [b, a]);
    try {
      expect(s.status).toBe(200);
      const job = await rt.next(runIdOf(s));
      await rt.decide(job, echoAnswer(job));
      expect((await s.terminal(15_000))?.event).toBe("run.finished");
    } finally {
      s.close();
    }
    const flowId = s.headers.get("x-flow-id") ?? "";
    const e11 = await call(hub, "GET", `/conversations/${conv}/messages?flow_id=${flowId}`, {
      token: tok.lan,
    });
    const items = (e11.json?.items ?? []) as Json[];
    const user = items.find((m) => m.role === "user");
    expect(user?.attachments?.map((x: Json) => x.id)).toEqual([b, a]);
    for (const x of user?.attachments ?? []) {
      expect(AttachmentRefSchema.safeParse(x).success).toBe(true);
      expect(x.available).toBe(true);
    }
    expect("attachments" in (items.find((m) => m.role === "assistant") ?? {})).toBe(false);
    const e10 = await call(hub, "GET", `/conversations/${conv}/flows`, { token: tok.lan });
    const q = ((e10.json?.items ?? []) as Json[])[0]?.preview?.question;
    expect(q?.attachments?.map((x: Json) => x.filename)).toEqual(["b-A47.pdf", "a-A47.pdf"]);
  });

  it("HUB-FR-44 · A48 · tin không file → không khoá attachments ở E10 (preview) và E11 (C1 không đổi) [H2c-R12]", async () => {
    const conv = await insertConv(sql, "lan", crypto.randomUUID());
    const flow = await insertFlow(sql, "lan", conv, crypto.randomUUID(), {
      msgs: [
        { role: "user", content: "không file" },
        { role: "assistant", content: "ok" },
      ],
    });
    const e11 = await call(hub, "GET", `/conversations/${conv}/messages?flow_id=${flow}`, {
      token: tok.lan,
    });
    for (const m of (e11.json?.items ?? []) as Json[]) expect("attachments" in m).toBe(false);
    const e10 = await call(hub, "GET", `/conversations/${conv}/flows`, { token: tok.lan });
    const p = ((e10.json?.items ?? []) as Json[])[0]?.preview;
    expect(["attachments" in (p?.question ?? {}), "attachments" in (p?.answer ?? {})]).toEqual([
      false,
      false,
    ]);
  });

  it("HUB-FR-44 · A49 · hàng gắn có purged_at → E10 preview + E11 attachments[].available = false [L9 · H2c-R12]", async () => {
    const conv = await insertConv(sql, "lan", crypto.randomUUID());
    const flow = await insertFlow(sql, "lan", conv, crypto.randomUUID(), {
      msgs: [{ role: "user", content: "file đã xoá nội dung" }],
    });
    const [m] = await userMessages(sql, flow);
    const id = await fresh({
      purged: true,
      bind: { messageId: m?.id ?? "", conversationId: conv, flowId: flow, position: 0 },
    });
    const e10 = await call(hub, "GET", `/conversations/${conv}/flows`, { token: tok.lan });
    const q = ((e10.json?.items ?? []) as Json[])[0]?.preview?.question;
    expect(q?.attachments).toMatchObject([{ id, available: false }]);
    const e11 = await call(hub, "GET", `/conversations/${conv}/messages?flow_id=${flow}`, {
      token: tok.lan,
    });
    expect(((e11.json?.items ?? []) as Json[])[0]?.attachments).toMatchObject([
      { id, available: false },
    ]);
  });
});

describe("A50–A52 · thứ tự kiểm [H2c-R10 · plan-errors §1]", () => {
  it("HUB-FR-44 · A50 · hội thoại người khác + id sai → 404 NOT_FOUND; body sai + id sai → 400; id sai + /khong-co, @nope x, /hoadon (thiếu file) → 404 AF (trước CMD_*/AGENT_NOT_FOUND) [H2c-R10]", async () => {
    const bad = crypto.randomUUID();
    const anConv = await insertConv(sql, "an", crypto.randomUUID());
    expect(codeOf(await post("x", [bad], { conv: anConv }))).toEqual({
      status: 404,
      code: "NOT_FOUND",
    });
    const conv = await insertConv(sql, "lan", crypto.randomUUID());
    const s = await sendWith(hub, tok.lan ?? "", conv, "", [bad]);
    s.close();
    expect(codeOf(s)).toEqual({ status: 400, code: "VALIDATION_ERROR" });
    for (const content of ["/khong-co x", "@nope x", "/hoadon"])
      expectAttachNotFound(await post(content, [bad]), [bad]);
  });

  it("HUB-FR-44 · A51 · id sai + flow lạ → 404 AF; id sai + flow đang chạy → 404 AF (trước FLOW_BUSY); id sai khi đã 2 run chạy → 404 AF (trước TOO_MANY_RUNS) [H2c-R10]", async () => {
    const bad = crypto.randomUUID();
    const conv = await insertConv(sql, "lan", crypto.randomUUID());
    expectAttachNotFound(await post("x", [bad], { conv, flowId: crypto.randomUUID() }), [bad]);
    const busy = await post("Đang chạy A51", undefined, { conv });
    expect(busy.status).toBe(200);
    expectAttachNotFound(await post("Tiếp", [bad], { conv, flowId: busy.flowId }), [bad]);
    await post("Thứ hai A51");
    expectAttachNotFound(await post("Thứ ba", [bad]), [bad]);
  });

  it("HUB-FR-44 · A52 · id hợp lệ + FLOW_BUSY → 409; + 2 run đang chạy → 429; file chưa gắn ở cả hai; đối chứng: gửi lại khi rảnh → gắn [H2c-R10 · R11]", async () => {
    const a = await fresh();
    const conv = await insertConv(sql, "lan", crypto.randomUUID());
    const busy = await post("Đang chạy A52", undefined, { conv });
    expect(codeOf(await post("Tiếp A52", [a], { conv, flowId: busy.flowId }))).toEqual({
      status: 409,
      code: "FLOW_BUSY",
    });
    await post("Thứ hai A52");
    expect(codeOf(await post("Thứ ba A52", [a]))).toEqual({ status: 429, code: "TOO_MANY_RUNS" });
    expect(await unbound(a)).toBe(true);
    await settleRuns(hub, sql, k);
    const ok = await post("Rảnh A52", [a]);
    expect(ok.status).toBe(200);
    await expectBound(a, ok.flowId, 0);
  });
});
