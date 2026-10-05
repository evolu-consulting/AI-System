// WRK-FR-03 · HUB-H2b-AC-04/05/06 (vế Hub) · H2b-R19, R22, R23 · plan §5.5, P11–P13 · plan-errors §3 · test-plan H2b §5,
// cases §2 A100–A117: Hub chuyển tiếp `job.delta` (XADD tay, `ScriptRuntime3`, L4) thành SSE `delta` khi step còn mở —
// chỉ job được phép stream (`payload.stream`, `accept` theo vai/loại run), `seq` liền mạch (hở → `delta_gap`), đối chiếu
// `reconcileStream` (lệch → giữ S + `delta_mismatch`; JSON cuối hỏng → S + `stream_unparsed`, không thử lại), lỗi khác →
// `run.failed`, huỷ, độ trễ, cắt 40 + emoji, E13 giữa stream.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import { call, type Json, type Keys, makeKeys, type Sql, sign, USERS } from "../H1/_fixtures";
import {
  deltaText,
  type HubX,
  isTerminal,
  openSse,
  type SseEv,
  terminalCount,
  testRedis,
} from "../H1/_hub";
import type { Job } from "../H1/_runtime";
import { type Dify, insertCatalog, startDify } from "../H2a/_h2a";
import { captureLogs, ScriptRuntime3, settleRuns, setupH2b, startHubH2b } from "./_h2b";
import {
  answer,
  arrival,
  deltasOf,
  expectDeltaBeforeStepEnd,
  expectDeltaShape,
  expectDeltas,
  expectNoDelta,
  hasLoneSurrogate,
  isDelta,
  jobCount,
  payloadsOf,
  quantile,
  type Run,
  startRun,
  stepDetail,
  stepIdOf,
  streamParts,
} from "./_stream";

let sql: Sql;
let k: Keys;
let hub: HubX;
let redis: Redis;
let rt: ScriptRuntime3;
let dify: Dify;

beforeAll(async () => {
  dify = startDify();
  sql = await setupH2b();
  await insertCatalog(sql, { baseUrl: dify.baseUrl, extras: true });
  k = await makeKeys();
  hub = await startHubH2b(k);
  redis = await testRedis();
  rt = new ScriptRuntime3(sql, redis);
}, 60_000);
afterEach(() => settleRuns(hub, sql, k));
afterAll(async () => {
  await hub?.stop();
  await dify?.close();
  redis?.disconnect();
  await sql?.end();
});

const start = async (content: string, who: "lan" | "hoa" = "lan"): Promise<Run> =>
  startRun(hub, sql, await sign(k, USERS[who]), { who, content });
/** Job kế của run, đúng vai `role` (run `direct` → `agent`; tin thường → `orchestrator`). */
async function nextAs(x: Run, role: "orchestrator" | "agent"): Promise<Job> {
  const job = await rt.next(x.runId);
  expect(job.payload.agent.role).toBe(role);
  return job;
}
async function finish(x: Run, event = "run.finished"): Promise<Json> {
  const end = await x.s.terminal(15_000);
  x.s.close();
  expect(end?.event).toBe(event);
  return end?.data;
}
async function assistantText(x: Run): Promise<string | undefined> {
  const res = await call(hub, "GET", `/conversations/${x.conv}/messages?flow_id=${x.flowId}`, {
    token: await sign(k, USERS.lan),
  });
  expect(res.status).toBe(200);
  return (res.json?.items ?? []).find((m: Json) => m.role === "assistant")?.content;
}
const sixty = (i: number) => `Đoạn ${i}: ${"chữ ".repeat(14)}`.slice(0, 60);

describe("A100 · payload.stream theo vai/loại run [H2b-R19]", () => {
  it("WRK-FR-03 · A100 · run orchestrated: Orchestrator stream=true mọi vòng; delegate đầu stream=true; delegate thứ 2 stream vắng/false [H2b-R19]", async () => {
    const x = await start("Câu A100 nhiều bước");
    const o1 = await nextAs(x, "orchestrator");
    expect(o1.payload.stream).toBe(true);
    await rt.decide(o1, { decision: "delegate", agent: "assistant", task: "Việc 1 A100" });
    const d1 = await nextAs(x, "agent");
    expect(d1.payload.stream).toBe(true);
    await rt.agent(d1, { status: "partial", text: "Một phần", missing: "phần còn lại" });
    const o2 = await nextAs(x, "orchestrator");
    expect(o2.payload.stream).toBe(true);
    await rt.decide(o2, { decision: "delegate", agent: "helper", task: "Việc 2 A100" });
    const d2 = await nextAs(x, "agent");
    expect(d2.payload.stream === undefined || d2.payload.stream === false).toBe(true);
    await rt.agent(d2, { status: "done", text: "Xong việc 2" });
    await rt.decide(await nextAs(x, "orchestrator"), answer("Tổng hợp A100."));
    await finish(x);
  });

  it("WRK-FR-03 · A100 · run direct (@assistant): job agent stream=true [H2b-R19]", async () => {
    const x = await start("@assistant Câu A100 direct");
    const j = await nextAs(x, "agent");
    expect(j.payload.stream).toBe(true);
    await rt.agent(j, { status: "done", text: "Trả lời A100." });
    await finish(x);
  });

  it("WRK-FR-03 · A100 · lệnh /dich-async: job workflow.async không có khoá stream [H2b-R19]", async () => {
    const x = await start("/dich-async en xin chào A100");
    const row = await rt.peek(x.runId);
    expect(row).toBeDefined();
    const [p] = await payloadsOf(sql, x.runId);
    expect(p?.type).toBe("workflow.async");
    expect(Object.keys(p ?? {})).not.toContain("stream");
    x.s.close();
  });
});

describe("A101–A106 · chuyển tiếp delta theo accept [HUB-H2b-AC-04 · HUB-H2b-AC-05 · H2b-R22]", () => {
  it("WRK-FR-03 · A101 · Orchestrator 5 × job.delta{answer} 60 ký tự cách 100 ms rồi answer (300) → delta trước step.finished của step Orchestrator, mọi delta ≤ 40, nối = content = E11, delta đầu trước run.finished ≥ 200 ms [HUB-H2b-AC-04 · H2b-R22]", async () => {
    const x = await start("Viết đoạn dài A101");
    const j = await nextAs(x, "orchestrator");
    const parts = [1, 2, 3, 4, 5].map(sixty);
    const full = parts.join("");
    expect(full.length).toBe(300);
    const tFirst = arrival(() => x.s.events.some(isDelta), 10_000);
    const tEnd = arrival(() => x.s.events.some(isTerminal), 15_000);
    await streamParts(rt, j, "answer", parts, 100);
    await expectDeltas(x.s, 1, 2_000);
    await rt.decide(j, answer(full));
    const end = await finish(x);
    expectDeltaBeforeStepEnd(x.s, await stepIdOf(sql, x.runId, "orchestrator"));
    expectDeltaShape(x.s);
    expect(deltaText(x.s.events)).toBe(full);
    expect(end?.content).toBe(full);
    expect(await assistantText(x)).toBe(full);
    expect((await tEnd) - (await tFirst)).toBeGreaterThanOrEqual(200);
  });

  it("WRK-FR-03 · A102 · Orchestrator phát kind=done → 0 delta trước job.result; content = kết quả cuối [H2b-R22]", async () => {
    const x = await start("Câu A102 orchestrated");
    const j = await nextAs(x, "orchestrator");
    await streamParts(rt, j, "done", ["Không được ", "chuyển tiếp"]);
    await expectNoDelta(x.s);
    await rt.decide(j, answer("Trả lời cuối A102."));
    expect((await finish(x))?.content).toBe("Trả lời cuối A102.");
    expect(deltaText(x.s.events)).toBe("Trả lời cuối A102.");
  });

  it("WRK-FR-03 · A102 · run direct phát kind=answer → 0 delta trước job.result; content = kết quả cuối [H2b-R22]", async () => {
    const x = await start("@assistant Câu A102 direct");
    const j = await nextAs(x, "agent");
    await streamParts(rt, j, "answer", ["Không được ", "chuyển tiếp"]);
    await expectNoDelta(x.s);
    await rt.agent(j, { status: "done", text: "Trả lời direct A102." });
    expect((await finish(x))?.content).toBe("Trả lời direct A102.");
    expect(deltaText(x.s.events)).toBe("Trả lời direct A102.");
  });

  it("WRK-FR-03 · A103 · run direct stream done → delta sớm (trước kết quả), nối = content [HUB-H2b-AC-05]", async () => {
    const x = await start("@assistant Viết thư A103");
    const j = await nextAs(x, "agent");
    const parts = ["Kính gửi anh chị, ", "đây là thư A103 ", "viết dần từng phần."];
    await streamParts(rt, j, "done", parts, 50);
    await expectDeltas(x.s, 1, 2_000);
    await rt.agent(j, { status: "done", text: parts.join("") });
    expect((await finish(x))?.content).toBe(parts.join(""));
    expectDeltaBeforeStepEnd(x.s, await stepIdOf(sql, x.runId, "delegate"));
    expect(deltaText(x.s.events)).toBe(parts.join(""));
  });

  it("WRK-FR-03 · A103 · run direct partial: stream 'A' rồi partial{A, B} → nối delta = 'A\\n\\nPhần chưa làm được: B' = content [HUB-H2b-AC-05 · H2b-R07]", async () => {
    const x = await start("@assistant Làm hai việc A103");
    const j = await nextAs(x, "agent");
    await rt.delta(j, "partial", "A");
    await expectDeltas(x.s, 1, 2_000);
    await rt.agent(j, { status: "partial", text: "A", missing: "B" });
    const want = "A\n\nPhần chưa làm được: B";
    expect((await finish(x))?.content).toBe(want);
    expect(deltaText(x.s.events)).toBe(want);
  });

  it("WRK-FR-03 · A104 · delegate đầu stream done → delta khi step delegate còn mở; done → pass-through, đúng 1 job Orchestrator [HUB-H2b-AC-05 · H2b-R22]", async () => {
    const x = await start("Nhờ trợ lý viết A104");
    await rt.decide(await nextAs(x, "orchestrator"), {
      decision: "delegate",
      agent: "assistant",
      task: "Viết A104",
    });
    const d = await nextAs(x, "agent");
    const parts = ["Bài viết A104 ", "của trợ lý ", "được gửi dần."];
    await streamParts(rt, d, "done", parts, 50);
    await expectDeltas(x.s, 1, 2_000);
    await rt.agent(d, { status: "done", text: parts.join("") });
    expect((await finish(x))?.content).toBe(parts.join(""));
    expectDeltaBeforeStepEnd(x.s, await stepIdOf(sql, x.runId, "delegate"));
    expect(deltaText(x.s.events)).toBe(parts.join(""));
    expect(await jobCount(sql, x.runId, "orchestrator")).toBe(1);
  });

  it("WRK-FR-03 · A105 · delegate đầu phát partial → không chuyển tiếp; Orchestrator gọi lại (2 job), content = answer [H2b-R22]", async () => {
    const x = await start("Nhờ trợ lý A105");
    await rt.decide(await nextAs(x, "orchestrator"), {
      decision: "delegate",
      agent: "assistant",
      task: "Việc A105",
    });
    const d = await nextAs(x, "agent");
    await streamParts(rt, d, "partial", ["Một phần ", "A105"]);
    await expectNoDelta(x.s);
    await rt.agent(d, { status: "partial", text: "Một phần A105", missing: "phần sau" });
    await rt.decide(await nextAs(x, "orchestrator"), answer("Tổng hợp A105."));
    expect((await finish(x))?.content).toBe("Tổng hợp A105.");
    expect(deltaText(x.s.events)).toBe("Tổng hợp A105.");
    expect(await jobCount(sql, x.runId, "orchestrator")).toBe(2);
  });

  it("WRK-FR-03 · A106 · delegate thứ 2 phát job.delta{done} (ép) → không delta nào từ nó [HUB-H2b-AC-05 · H2b-R22]", async () => {
    const x = await start("Hai việc A106");
    await rt.decide(await nextAs(x, "orchestrator"), {
      decision: "delegate",
      agent: "assistant",
      task: "Việc 1 A106",
    });
    await rt.agent(await nextAs(x, "agent"), { status: "partial", text: "Nửa", missing: "nửa" });
    await rt.decide(await nextAs(x, "orchestrator"), {
      decision: "delegate",
      agent: "helper",
      task: "Việc 2 A106",
    });
    const d2 = await nextAs(x, "agent");
    await streamParts(rt, d2, "done", ["Lạc từ ", "delegate 2"]);
    await expectNoDelta(x.s);
    await rt.agent(d2, { status: "done", text: "Lạc từ delegate 2" });
    await rt.decide(await nextAs(x, "orchestrator"), answer("Kết luận A106."));
    expect((await finish(x))?.content).toBe("Kết luận A106.");
    expect(deltaText(x.s.events)).toBe("Kết luận A106.");
  });
});

describe("A107–A113 · đối chiếu S/F, trace, lỗi sau khi phát [HUB-H2b-AC-06 · H2b-R23 · P11 · P12]", () => {
  it("WRK-FR-03 · A107 · S='Xin chào', F='Chào bạn' → không phát thêm; content = E11 = S; step detail.stream=delta_mismatch, streamed_len, final_len; warn run-delta-mismatch [HUB-H2b-AC-06 · H2b-R23]", async () => {
    const log = captureLogs();
    try {
      const x = await start("Chào hỏi A107");
      const j = await nextAs(x, "orchestrator");
      await rt.delta(j, "answer", "Xin chào");
      await expectDeltas(x.s, 1, 2_000);
      await rt.decide(j, answer("Chào bạn"));
      expect((await finish(x))?.content).toBe("Xin chào");
      expect(deltaText(x.s.events)).toBe("Xin chào");
      expect(await assistantText(x)).toBe("Xin chào");
      expect(await stepDetail(sql, x.runId, "orchestrator")).toMatchObject({
        stream: "delta_mismatch",
        streamed_len: 8,
        final_len: 8,
      });
      const hit = log.lines.find(
        (l) => l.rec.msg === "run-delta-mismatch" && l.rec.run_id === x.runId,
      );
      expect(hit?.level).toBe("warn");
      expect(typeof hit?.rec.step_id).toBe("string");
    } finally {
      log.restore();
    }
  });

  it("WRK-FR-03 · A108 · Orchestrator stream rồi JSON hỏng → không job Orchestrator thứ 2; run.finished content = S; stream_unparsed + warn run-stream-unparsed [H2b-R23 · P12]", async () => {
    const log = captureLogs();
    try {
      const x = await start("Câu A108");
      const j = await nextAs(x, "orchestrator");
      await rt.delta(j, "answer", "Câu trả lời dở A108");
      await expectDeltas(x.s, 1, 2_000);
      await rt.rawDecide(j, "{không phải JSON");
      expect(await rt.tryNext(x.runId, 1_500)).toBeUndefined();
      expect((await finish(x))?.content).toBe("Câu trả lời dở A108");
      expect(await jobCount(sql, x.runId, "orchestrator")).toBe(1);
      expect((await stepDetail(sql, x.runId, "orchestrator"))?.stream).toBe("stream_unparsed");
      const hit = log.lines.find(
        (l) => l.rec.msg === "run-stream-unparsed" && l.rec.run_id === x.runId,
      );
      expect(hit?.level).toBe("warn");
    } finally {
      log.restore();
    }
  });

  it("WRK-FR-03 · A109 · run direct stream rồi job.failed UPSTREAM_ERROR invalid_output → run.finished (không run.failed), content = S, stream_unparsed [H2b-R23 · P12]", async () => {
    const x = await start("@assistant Câu A109");
    const j = await nextAs(x, "agent");
    await rt.delta(j, "done", "Phần đầu A109");
    await expectDeltas(x.s, 1, 2_000);
    await rt.fail(j, "UPSTREAM_ERROR", "bad final json", "invalid_output");
    expect((await finish(x))?.content).toBe("Phần đầu A109");
    expect((await stepDetail(sql, x.runId, "delegate"))?.stream).toBe("stream_unparsed");
  });

  for (const c of [
    { code: "ALL_PROVIDERS_EXHAUSTED", reason: "quota", status: "failed" },
    { code: "TIMEOUT", reason: "timeout", status: "timed_out" },
  ] as const) {
    it(`WRK-FR-03 · A110 · stream rồi job.failed ${c.code} (${c.status}) → run.failed ${c.code}; đúng 1 sự kiện kết thúc [H2b-R23]`, async () => {
      const x = await start(`Câu A110 ${c.code}`);
      const j = await nextAs(x, "orchestrator");
      await rt.delta(j, "answer", "Đang trả lời A110");
      await expectDeltas(x.s, 1, 2_000);
      await rt.fail(j, c.code, "lỗi sau khi phát", c.reason, c.status);
      expect((await finish(x, "run.failed"))?.code).toBe(c.code);
      expect(await terminalCount(redis, x.runId)).toBe(1);
    });
  }

  it("WRK-FR-03 · A111 · huỷ giữa stream → run.failed CANCELLED ≤ 5 000 ms [HUB-H2b-AC-06]", async () => {
    const x = await start("Câu dài A111");
    const j = await nextAs(x, "orchestrator");
    await streamParts(rt, j, "answer", [sixty(1), sixty(2)], 50);
    await expectDeltas(x.s, 1, 2_000);
    const t0 = Date.now();
    const res = await call(hub, "POST", `/runs/${x.runId}/cancel`, {
      token: await sign(k, USERS.lan),
    });
    expect(res.status).toBe(200);
    expect((await finish(x, "run.failed"))?.code).toBe("CANCELLED");
    expect(Date.now() - t0).toBeLessThanOrEqual(5_000);
  });

  it("WRK-FR-03 · A112 · seq 1 (started), 2 (delta), 4 (delta) → ngừng chuyển tiếp sau seq 2; delta_gap seq_expected 3 seq_seen 4 + warn run-delta-gap; F bắt đầu bằng S → phát phần còn lại, content = F [P11]", async () => {
    const log = captureLogs();
    try {
      const x = await start("Câu A112");
      const j = await nextAs(x, "orchestrator");
      await rt.delta(j, "answer", "Xin ");
      await expectDeltas(x.s, 1, 2_000);
      rt.skipSeq(j, 1);
      await rt.delta(j, "answer", "chào");
      expect(await x.s.until((e) => isDelta(e) && e.data?.text !== "Xin ", 800)).toBeUndefined();
      await rt.decide(j, answer("Xin chào bạn"));
      expect((await finish(x))?.content).toBe("Xin chào bạn");
      expect(deltaText(x.s.events)).toBe("Xin chào bạn");
      expect(await stepDetail(sql, x.runId, "orchestrator")).toMatchObject({
        stream: "delta_gap",
        seq_expected: 3,
        seq_seen: 4,
      });
      const hit = log.lines.find((l) => l.rec.msg === "run-delta-gap" && l.rec.job_id === j.id);
      expect(hit?.level).toBe("warn");
      expect(hit?.rec.run_id).toBe(x.runId);
    } finally {
      log.restore();
    }
  });

  it("WRK-FR-03 · A113 · F = S → không phát thêm; content = F; step không có trace stream [H2b-R23]", async () => {
    const x = await start("Câu A113");
    const j = await nextAs(x, "orchestrator");
    await rt.delta(j, "answer", "Chào bạn A113");
    await expectDeltas(x.s, 1, 2_000);
    await rt.decide(j, answer("Chào bạn A113"));
    expect((await finish(x))?.content).toBe("Chào bạn A113");
    expect(deltasOf(x.s).map((e) => e.data?.text)).toEqual(["Chào bạn A113"]);
    expect((await stepDetail(sql, x.runId, "orchestrator"))?.stream).toBeUndefined();
  });

  it("WRK-FR-03 · A113 · Orchestrator ask (không delta) → như H1: ask + content = câu hỏi [H2b-R23]", async () => {
    const x = await start("Câu mơ hồ A113");
    const j = await nextAs(x, "orchestrator");
    await rt.decide(j, { decision: "ask", question: "Bạn muốn gì?", choices: ["A", "B"] });
    expect((await finish(x))?.content).toBe("Bạn muốn gì?");
    const ask = x.s.events.find((e) => e.event === "ask");
    expect(ask?.data).toEqual({ question: "Bạn muốn gì?", choices: ["A", "B"] });
    expect(deltaText(x.s.events)).toBe("Bạn muốn gì?");
  });

  it("WRK-FR-03 · A113 · run direct need_input (không delta) → ask như H1 [H2b-R23 · H2b-R07]", async () => {
    const x = await start("@assistant Đặt lịch A113");
    const j = await nextAs(x, "agent");
    await rt.agent(j, { status: "need_input", question: "Ngày nào?", choices: [] });
    expect((await finish(x))?.content).toBe("Ngày nào?");
    expect(x.s.events.find((e) => e.event === "ask")?.data?.question).toBe("Ngày nào?");
    expect(deltaText(x.s.events)).toBe("Ngày nào?");
  });
});

describe("A114–A117 · tách job, độ trễ, cắt, E13 [H2b-R22 · spec §6 · C1 §2.5]", () => {
  it("WRK-FR-03 · A114 · job.delta{answer} của job delegate phát trước job.started của Orchestrator vòng 2 → không lẫn vào S của Orchestrator [H2b-R22]", async () => {
    const x = await start("Nhờ trợ lý A114");
    await rt.decide(await nextAs(x, "orchestrator"), {
      decision: "delegate",
      agent: "assistant",
      task: "Việc A114",
    });
    const d = await nextAs(x, "agent");
    await rt.agent(d, { status: "partial", text: "Một phần A114", missing: "phần sau" });
    expect(await rt.peek(x.runId)).toBeDefined();
    await rt.delta(d, "answer", "LẠC ");
    const o2 = await nextAs(x, "orchestrator");
    await rt.delta(o2, "answer", "Trả lời cuối A114");
    await expectDeltas(x.s, 1, 2_000);
    await rt.decide(o2, answer("Trả lời cuối A114"));
    expect((await finish(x))?.content).toBe("Trả lời cuối A114");
    expect(deltaText(x.s.events)).toBe("Trả lời cuối A114");
    expect(deltasOf(x.s).some((e) => String(e.data?.text).includes("LẠC"))).toBe(false);
    expect((await stepDetail(sql, x.runId, "orchestrator", 1))?.stream).toBeUndefined();
  });

  it("WRK-FR-03 · A115 · XADD job.delta → SSE delta: trung vị 10 chunk ≤ 150 ms [spec §6 · Q-T4]", async () => {
    const x = await start("Câu A115");
    const j = await nextAs(x, "orchestrator");
    const lat: number[] = [];
    const parts = Array.from({ length: 10 }, (_, i) => `Mẩu ${i} của A115. `);
    for (const [i, p] of parts.entries()) {
      const t0 = Date.now();
      await rt.delta(j, "answer", p);
      lat.push((await arrival(() => deltasOf(x.s).length >= i + 1, 1_000)) - t0);
    }
    expect(quantile(lat, 0.5)).toBeLessThanOrEqual(150);
    await rt.decide(j, answer(parts.join("")));
    expect((await finish(x))?.content).toBe(parts.join(""));
  });

  it("WRK-FR-03 · A116 · job.delta 4 000 ký tự có emoji → mọi delta ≤ 40, không surrogate lẻ, nối đúng [T13 · H1-R09]", async () => {
    const x = await start("Câu A116");
    const j = await nextAs(x, "orchestrator");
    const text = "Chữ😀 ".repeat(800);
    expect([...text].length).toBe(4_000);
    await rt.delta(j, "answer", text);
    await expectDeltas(x.s, 1, 2_000);
    await rt.decide(j, answer(text));
    expect((await finish(x))?.content).toBe(text);
    expectDeltaShape(x.s);
    expect(deltaText(x.s.events)).toBe(text);
    expect(hasLoneSurrogate(deltaText(x.s.events))).toBe(false);
  });

  it("WRK-FR-03 · A117 · E13 Last-Event-ID giữa stream → phát lại đúng phần sau, không trùng delta [C1 §2.5 · H1-R12]", async () => {
    const x = await start("Câu A117");
    const j = await nextAs(x, "orchestrator");
    const parts = Array.from({ length: 5 }, (_, i) => `Phần ${i} của câu trả lời A117. `);
    await streamParts(rt, j, "answer", parts.slice(0, 3));
    await expectDeltas(x.s, 3, 2_000);
    const lastId = deltasOf(x.s)[1]?.id ?? 0;
    const again = await openSse(hub, "GET", `/runs/${x.runId}/events`, {
      token: await sign(k, USERS.lan),
      headers: { "Last-Event-ID": String(lastId) },
    });
    expect(again.status).toBe(200);
    await streamParts(rt, j, "answer", parts.slice(3));
    await rt.decide(j, answer(parts.join("")));
    expect((await finish(x))?.content).toBe(parts.join(""));
    await again.terminal(10_000);
    again.close();
    expect(again.events).toEqual(x.s.events.filter((e: SseEv) => (e.id ?? 0) > lastId));
    const ids = again.events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(deltaText(x.s.events)).toBe(parts.join(""));
  });
});
