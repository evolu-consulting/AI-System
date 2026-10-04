// HUB-BR-04, HUB-FR-13, HUB-FR-43 · HUB-H2a-AC-03 · H2a-R10, R11 · test-plan H2a §5 A20–A26: ánh xạ lỗi Dify sync
// (`plan-errors` §2) → `run.failed` với câu `runErrorText` H1, không retry sync, timeout/huỷ gọi API stop, secret hỏng →
// `NOT_CONFIGURED` không gọi Dify, thân lỗi chứa key chỉ vào trace đã che (≤ 300). Mock MK sau proxy `_h2a.ts`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { setSink } from "../../../apps/hub-api/src/lib/logger";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import { runErrorText } from "../../../apps/hub-api/src/modules/runs/run-errors";
import {
  call,
  insertFixture,
  type Json,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  type Sql,
  sign,
  USERS,
  type UserKey,
} from "../H1/_fixtures";
import {
  type HubX,
  insertConv,
  insertHubConfig,
  runIdOf,
  type Sse,
  send,
  testRedis,
} from "../H1/_hub";
import {
  corruptSecret,
  type Dify,
  idGen2,
  insertCatalog,
  LEAK_ECHO,
  leakForms,
  secretIdOf,
  setAppKey,
  startDify,
  startHubH2a,
  WF,
  type WfName,
} from "./_h2a";

let sql: Sql;
let k: Keys;
let hub: HubX;
let redis: Redis;
let dify: Dify;
const id = idGen2(3000);
const lines: string[] = [];
let restore: () => void = () => {};

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  dify = startDify();
  await insertCatalog(sql, { baseUrl: dify.baseUrl, extras: true });
  k = await makeKeys();
  restore = setSink((_level, line) => lines.push(line));
  hub = await startHubH2a(k);
  redis = await testRedis();
}, 60_000);
afterAll(async () => {
  restore();
  await hub?.stop();
  await dify?.close();
  redis?.disconnect();
  await sql?.end();
});
afterEach(async () => {
  await setAppKey(sql, "dich", "mk-ok");
  await setAppKey(sql, "hoi", "mk-agent");
});

/** Đặt app-key cho `w`, xoá log mock, gửi `content`, chờ kết thúc (≤ `ms`). */
async function runWith(w: WfName, key: string, content: string, who: UserKey = "lan", ms = 8_000) {
  await setAppKey(sql, w, key);
  dify.mock.reset();
  const conv = await insertConv(sql, who, id());
  const s = await send(hub, await sign(k, USERS[who]), conv, content);
  try {
    if (s.status === 200) await s.terminal(ms);
  } finally {
    s.close();
  }
  return s;
}
const failedOf = (s: Sse): Json => s.events.find((e) => e.event === "run.failed")?.data;
/** `run.failed` đúng `code`, câu = `runErrorText(code, locale)` H1, không có `run.finished`. */
function expectFailed(s: Sse, code: "NOT_CONFIGURED" | "UPSTREAM_ERROR" | "TIMEOUT" | "CANCELLED") {
  expect(s.status).toBe(200);
  expect(s.events.some((e) => e.event === "run.finished")).toBe(false);
  const f = failedOf(s);
  expect(f?.code).toBe(code);
  const t = runErrorText(code, "vi");
  expect({ message: f?.message, hint: f?.hint }).toEqual({ message: t.message, hint: t.hint });
  expect(JSON.stringify(f)).not.toContain("mock");
}

describe("A20–A22 · ánh xạ lỗi HTTP / SSE Dify [HUB-H2a-AC-03 · HUB-BR-04 · H2a-R11]", () => {
  it("A20 · mk-401 → NOT_CONFIGURED; mk-404 → NOT_CONFIGURED; mk-400 → UPSTREAM_ERROR; message = runErrorText, không chứa thân lỗi mock [HUB-H2a-AC-03]", async () => {
    for (const [key, code] of [
      ["mk-401", "NOT_CONFIGURED"],
      ["mk-404", "NOT_CONFIGURED"],
      ["mk-400", "UPSTREAM_ERROR"],
    ] as const) {
      const s = await runWith("dich", key, "/dich en xin");
      expect(dify.runs().length).toBe(1);
      expectFailed(s, code);
    }
  });

  it("A21 · mk-503x1 → UPSTREAM_ERROR, MK đúng 1 lời gọi (sync không retry) [HUB-H2a-AC-03]", async () => {
    const s = await runWith("dich", "mk-503x1", "/dich en xin");
    expectFailed(s, "UPSTREAM_ERROR");
    await Bun.sleep(300);
    expect(dify.runs().length).toBe(1);
  });

  it("A22 · mk-failed (200 + status=failed), mk-error-event, mk-empty → UPSTREAM_ERROR; không run.finished rỗng [HUB-H2a-AC-03 · HUB-BR-04]", async () => {
    for (const key of ["mk-failed", "mk-error-event", "mk-empty"]) {
      const s = await runWith("dich", key, "/dich en xin");
      expect(dify.runs().length).toBe(1);
      expectFailed(s, "UPSTREAM_ERROR");
    }
  });
});

describe("A23–A24 · timeout và huỷ gọi stop [HUB-H2a-AC-03 · H2a-R10 · HUB-FR-43]", () => {
  it("A23 · /cham (timeout_s=1) + mk-slow-800 → run.failed TIMEOUT; MK nhận POST /v1/workflows/tasks/task-1/stop ≤ 3 s sau [H2a-R10]", async () => {
    const s = await runWith("dich", "mk-slow-800", "/cham en xin", "lan", 6_000);
    const tEnd = Date.now();
    expectFailed(s, "TIMEOUT");
    expect(dify.runs().length).toBe(1);
    const end = Date.now() + 3_000;
    while (dify.stops().length === 0 && Date.now() < end) await Bun.sleep(50);
    const stops = dify.stops();
    expect(stops.map((c) => c.path)).toEqual(["/v1/workflows/tasks/task-1/stop"]);
    expect((stops[0]?.at ?? Number.POSITIVE_INFINITY) - tEnd).toBeLessThanOrEqual(3_000);
    expect(stops[0]?.auth).toBe("Bearer mk-slow-800");
  });

  it("A24 · mk-slow-500 → POST /runs/:id/cancel → run.failed CANCELLED ≤ 5 000 ms + MK nhận stop; app chat (/hoi) → stop /v1/chat-messages/<task>/stop [HUB-FR-43 · H2a-R10]", async () => {
    for (const [w, content, stopPath] of [
      ["dich", "/dich en xin", "/v1/workflows/tasks/task-1/stop"],
      ["hoi", "/hoi xin chào", "/v1/chat-messages/task-1/stop"],
    ] as const) {
      await setAppKey(sql, w, "mk-slow-500");
      dify.mock.reset();
      const conv = await insertConv(sql, "lan", id());
      const token = await sign(k, USERS.lan);
      const s = await send(hub, token, conv, content);
      try {
        expect(s.status).toBe(200);
        expect(await s.until((e) => e.event === "delta", 5_000)).toBeDefined();
        const t0 = Date.now();
        const res = await call(hub, "POST", `/runs/${runIdOf(s)}/cancel`, { token });
        expect(res.status).toBe(200);
        const end = await s.terminal(5_000);
        expect(end?.event).toBe("run.failed");
        expect(end?.data?.code).toBe("CANCELLED");
        expect(Date.now() - t0).toBeLessThanOrEqual(5_000);
        const until = Date.now() + 3_000;
        while (dify.stops().length === 0 && Date.now() < until) await Bun.sleep(50);
        expect(dify.stops().map((c) => c.path)).toEqual([stopPath]);
      } finally {
        s.close();
      }
    }
  });
});

describe("A25–A26 · secret hỏng, thân lỗi chứa key [H2a-R11 · H2a-R17]", () => {
  it("A25 · bản mã hỏng / key_version lệch → NOT_CONFIGURED, MK 0 lời gọi; log có secret_decrypt_failed + workflow_id, không bản mã [H2a-R11]", async () => {
    for (const breakIt of [
      () => corruptSecret(sql, "dich"),
      () => sql`update admin.secrets set key_version = 2 where id = ${secretIdOf("dich")}`,
    ]) {
      await setAppKey(sql, "dich", "mk-ok");
      await breakIt();
      const [sec] = await sql<{ hex: string }[]>`select encode(ciphertext, 'hex') as hex
        from admin.secrets where id = ${secretIdOf("dich")}`;
      dify.mock.reset();
      const from = lines.length;
      const conv = await insertConv(sql, "lan", id());
      const s = await send(hub, await sign(k, USERS.lan), conv, "/dich en xin");
      try {
        if (s.status === 200) await s.terminal(8_000);
      } finally {
        s.close();
      }
      expectFailed(s, "NOT_CONFIGURED");
      expect(dify.runs().length).toBe(0);
      const mine = lines.slice(from);
      expect(mine.some((l) => l.includes("secret_decrypt_failed") && l.includes(WF.dich))).toBe(
        true,
      );
      for (const l of mine) {
        expect(l).not.toContain(sec?.hex ?? "∅");
        expect(l).not.toContain(Buffer.from(sec?.hex ?? "", "hex").toString("base64") || "∅");
      }
    }
  });

  it("A26 · Dify trả 400 với thân chứa key (thô/base64/hex, > 300 ký tự) → UPSTREAM_ERROR; run_steps.detail.upstream ≤ 300, có '***', không dạng nào của key [H2a-R11 · H2a-R17]", async () => {
    const s = await runWith("dich", LEAK_ECHO, "/dich en xin");
    expect(dify.echoCount()).toBe(1);
    expectFailed(s, "UPSTREAM_ERROR");
    const steps = await sql<{ detail: Json }[]>`select detail from hub.run_steps
      where run_id = ${runIdOf(s)} and type = 'workflow'`;
    expect(steps.length).toBe(1);
    const upstream = steps[0]?.detail?.upstream;
    expect(typeof upstream).toBe("string");
    expect(String(upstream).length).toBeLessThanOrEqual(300);
    expect(String(upstream)).toContain("***");
    const all = JSON.stringify(steps) + JSON.stringify(s.events);
    for (const f of leakForms(LEAK_ECHO)) expect(all).not.toContain(f);
    expect(all).not.toContain("LEAK_KEY");
  });
});
