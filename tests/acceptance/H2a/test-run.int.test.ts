// HUB-FR-51 · HUB-H2a-AC-08 · H2a-R24 · Q13, Q16, Q-T4 · plan §2.3–2.4 · test-plan H2a cases §6 A70–A75: `POST
// /internal/test-run` (Admin → Hub) với token dịch vụ — chạy command nháp sync, không kiểm quyền, không ghi hội thoại/run/
// usage/job; 401 đồng nhất, 503 khi vắng `HUB_INTERNAL_TOKEN`; thiếu arg 422, body sai 400, lỗi Dify → 200 `ok:false` (detail
// ≤ 300 đã che key), secret thiếu/hỏng → 409; trả JSON (không SSE), timeout nháp → `ok:false TIMEOUT` + stop.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ErrorResponseSchema, TestRunResponseSchema } from "@ai/contracts/hub-internal";
import {
  call,
  counts,
  insertFixture,
  type Json,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  type Res,
  type Sql,
  sign,
  UNKNOWN,
  USERS,
  type UserKey,
  waitFor,
} from "../H1/_fixtures";
import { type HubX, insertHubConfig } from "../H1/_hub";
import {
  ARGS_DICH,
  corruptSecret,
  type Dify,
  INTERNAL_TOKEN,
  insertCatalog,
  LEAK_ECHO,
  leakForms,
  MAP_DICH,
  OUT,
  setAppKey,
  startDify,
  startHubH2a,
  WF,
} from "./_h2a";
import { MOCK_TEXT } from "./_h2a2";

let sql: Sql;
let k: Keys;
let hub: HubX;
let dify: Dify;

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  dify = startDify();
  await insertCatalog(sql, { baseUrl: dify.baseUrl });
  k = await makeKeys();
  hub = await startHubH2a(k);
}, 60_000);
afterAll(async () => {
  await hub?.stop();
  await dify?.close();
  await sql?.end();
});

type Draft = {
  workflow_id?: string;
  args?: unknown;
  input_map?: unknown;
  timeout_s?: number;
};
const body = (text: string, d: Draft = {}, who: UserKey = "padmin", extra: Json = {}) => ({
  command: {
    workflow_id: d.workflow_id ?? WF.dich,
    args: d.args ?? ARGS_DICH,
    input_map: d.input_map ?? MAP_DICH,
    output: OUT,
    timeout_s: d.timeout_s ?? 10,
  },
  text,
  actor_user_id: USERS[who].id,
  ...extra,
});
const testRun = (b: unknown, auth: string | null = INTERNAL_TOKEN, h: HubX = hub): Promise<Res> =>
  call(h, "POST", "/internal/test-run", {
    headers: auth === null ? {} : { authorization: `Bearer ${auth}` },
    body: b,
  });
const codeOf = (r: Res) => ErrorResponseSchema.safeParse(r.json).data?.error.code;
const TABLES = async () => {
  const c = await counts(sql);
  const [u] = await sql<{ n: number }[]>`select count(*)::int as n from hub.usage_logs`;
  return { ...c, usage_logs: u?.n ?? -1 };
};

describe("A70–A72 · test-run nháp chạy sync, không ghi hội thoại [HUB-FR-51 · HUB-H2a-AC-08]", () => {
  it("HUB-FR-51 · A70 · Bearer đúng + command nháp /dich → 200 {ok:true, output, steps≤10, usage, ms}; MK user platform:<padmin>; conversations/runs/messages/usage_logs/jobs không đổi [HUB-FR-51 · HUB-H2a-AC-08 · Q13]", async () => {
    dify.mock.reset();
    const before = await TABLES();
    const r = await testRun(body("en xin chào"));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type") ?? "").toContain("application/json");
    const p = TestRunResponseSchema.safeParse(r.json);
    expect(p.success).toBe(true);
    expect(p.data).toMatchObject({ ok: true, output: MOCK_TEXT });
    expect(p.data?.steps.length).toBeGreaterThanOrEqual(1);
    expect(p.data?.usage.input_tokens).toBe(20);
    const runs = dify.runs();
    expect(runs.length).toBe(1);
    expect(runs[0]?.body).toMatchObject({
      user: `platform:${USERS.padmin.id}`,
      inputs: { source_text: "xin chào", target_lang: "en", tone: "neutral" },
      response_mode: "streaming",
    });
    expect(await TABLES()).toEqual(before);
  });

  it("HUB-FR-51 · A71 · không header / token sai / JWT padmin hợp lệ → 401 UNAUTHORIZED cùng body; vắng HUB_INTERNAL_TOKEN → 503 UNAVAILABLE [HUB-H2a-AC-08]", async () => {
    const jwt = await sign(k, USERS.padmin);
    const got = [
      await testRun(body("en xin"), null),
      await testRun(body("en xin"), "qc-internal-token-SAI-0123456789abcdef0"),
      await testRun(body("en xin"), jwt),
    ];
    for (const r of got) {
      expect(r.status).toBe(401);
      expect(codeOf(r)).toBe("UNAUTHORIZED");
    }
    const strip = (r: Res) => JSON.stringify({ ...r.json, request_id: undefined });
    expect(new Set(got.map(strip)).size).toBe(1);
    const bare = await startHubH2a(k, { internalToken: undefined, instanceId: "qc-hub-h2a-noint" });
    try {
      const r = await testRun(body("en xin"), INTERNAL_TOKEN, bare);
      expect(r.status).toBe(503);
      expect(codeOf(r)).toBe("UNAVAILABLE");
    } finally {
      await bare.stop();
    }
  });

  it("HUB-FR-51 · A72 · command nháp có workflow mà actor không có feature nào chứa (tom, user beta an) → vẫn chạy ok:true [H2a-R24]", async () => {
    dify.mock.reset();
    const r = await testRun(
      body(
        "đoạn văn cần tóm tắt",
        {
          workflow_id: WF.tom,
          args: [ARGS_DICH[1]],
          input_map: { source_text: { source: "arg", value: "text" } },
        },
        "an",
      ),
    );
    expect(r.status).toBe(200);
    expect(r.json?.ok).toBe(true);
    expect(dify.runs()[0]?.body).toMatchObject({ user: `beta:${USERS.an.id}` });
  });
});

describe("A73–A75 · lỗi test-run [H2a-R24 · Q16 · Q-T4]", () => {
  it("HUB-FR-51 · A73 · thiếu arg → 422 CMD_MISSING_ARG; body sai → 400; mk-failed → 200 ok:false UPSTREAM_ERROR; thân lỗi chứa key → detail ≤ 300 đã che [H2a-R24 · Q16]", async () => {
    const miss = await testRun(body(""));
    expect(miss.status).toBe(422);
    expect(codeOf(miss)).toBe("CMD_MISSING_ARG");
    expect(ErrorResponseSchema.safeParse(miss.json).data?.error.details).toEqual({
      missing: ["lang", "text"],
      invalid: [],
    });
    for (const bad of [
      { text: "en xin" },
      body("en xin", {}, "padmin", { la: 1 }),
      body("en xin", { timeout_s: 0 }),
    ]) {
      const r = await testRun(bad);
      expect(r.status).toBe(400);
      expect(codeOf(r)).toBe("VALIDATION_ERROR");
    }
    try {
      await setAppKey(sql, "dich", "mk-failed");
      const f = await testRun(body("en xin"));
      expect(f.status).toBe(200);
      expect(f.json).toMatchObject({ ok: false, error: { code: "UPSTREAM_ERROR" } });
      expect(TestRunResponseSchema.safeParse(f.json).success).toBe(true);
      await setAppKey(sql, "dich", LEAK_ECHO);
      const e = await testRun(body("en xin"));
      expect(e.status).toBe(200);
      expect(e.json).toMatchObject({ ok: false, error: { code: "UPSTREAM_ERROR" } });
      expect(dify.echoCount()).toBeGreaterThanOrEqual(1);
      const detail = String(e.json?.error?.detail ?? "");
      expect(detail.length).toBeGreaterThan(0);
      expect(detail.length).toBeLessThanOrEqual(300);
      expect(detail).toContain("***");
      for (const f2 of leakForms(LEAK_ECHO)) expect(e.text).not.toContain(f2);
    } finally {
      await setAppKey(sql, "dich", "mk-ok");
    }
  });

  it("HUB-FR-51 · A74 · secret hỏng / workflow không có → 409 NOT_CONFIGURED, MK 0 lời gọi [H2a-R24 · Q-T4]", async () => {
    dify.mock.reset();
    try {
      await corruptSecret(sql, "dich");
      const r = await testRun(body("en xin"));
      expect(r.status).toBe(409);
      expect(codeOf(r)).toBe("NOT_CONFIGURED");
    } finally {
      await setAppKey(sql, "dich", "mk-ok");
    }
    const none = await testRun(body("en xin", { workflow_id: UNKNOWN }));
    expect(none.status).toBe(409);
    expect(codeOf(none)).toBe("NOT_CONFIGURED");
    expect(dify.runs().length).toBe(0);
  });

  it("HUB-FR-51 · A75 · trả JSON (không SSE); timeout_s nháp 1 + mk-slow-800 → ok:false TIMEOUT + MK nhận stop [H2a-R24 · H2a-R10]", async () => {
    try {
      await setAppKey(sql, "dich", "mk-slow-800");
      dify.mock.reset();
      const t0 = Date.now();
      const r = await testRun(body("en xin", { timeout_s: 1 }));
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type") ?? "").toContain("application/json");
      expect(r.json).toMatchObject({ ok: false, error: { code: "TIMEOUT" } });
      expect(Date.now() - t0).toBeLessThanOrEqual(1_000 + 3_000);
      const stops = await waitFor(
        async () => dify.stops(),
        (v) => v.length > 0,
        3_000,
      );
      expect(stops.length).toBeGreaterThan(0);
    } finally {
      await setAppKey(sql, "dich", "mk-ok");
    }
  });
});
