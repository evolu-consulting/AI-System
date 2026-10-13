// HUB-FR-66 · AC-H4b2-02 · spec H4b2 §3 A (`POST /providers/:id/check`, ProviderCheckResult) · plan §3.2, §4, §5 · Q3, Q7
// · test-plan H4b2 §3 C01–C14: "Kiểm tra key" (api: vendor `fake` trong tiến trình; anthropic/openai/google qua `fetch`
// tiêm — URL/header theo bảng hãng, `redirect:"error"`, lỗi nguyên văn đã che key, timeout/network, secret không đọc được,
// NOT_CONFIGURED) và "Kiểm tra lại" (subscription: Hub xoá `last_probe_at`, chờ probe của Runtime ≤ 10 s qua `sleep` tiêm,
// không đụng `updated_at`). Audit `check` không bump, không `message`; log/response/audit không chứa key.
// Đỏ trước code: route chưa mount ⇒ 404 ≠ kỳ vọng.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { call } from "../H1/_fixtures";
import { startHubH3b, tok } from "../H3b/_h3b";
import {
  apiBody,
  auditMax,
  auditSince,
  type Ctx,
  captureAll,
  errOf,
  expectNoChunk,
  expectNoKey,
  expectSchema,
  type FetchCall,
  type Json,
  KEY,
  mkProvider,
  NONE,
  pa,
  type Res,
  SEC,
  setState,
  startH4b2,
  stubFetch,
  subBody,
  versionOf,
} from "./_h4b2";

/** Hãng giả theo URL: openai vọng key (401), anthropic 200, google 500, host `slow` ⇒ timeout, `down` ⇒ network. */
function vendorStub(c: FetchCall): Response {
  if (c.url.includes("slow.example.test")) throw new DOMException("timed out", "TimeoutError");
  if (c.url.includes("down.example.test")) throw new TypeError("fetch failed");
  if (c.url.includes("api.openai.com")) {
    const k = (c.headers.authorization ?? "").replace(/^Bearer /, "");
    const body = { error: { message: `Incorrect API key provided: ${k}. Rotate it.` } };
    return new Response(JSON.stringify(body), { status: 401 });
  }
  if (c.url.includes("generativelanguage.googleapis.com"))
    return new Response("upstream exploded", { status: 500 });
  return new Response('{"data":[]}', { status: 200 });
}
const fetchStub = stubFetch(vendorStub);
/** Hook `sleep` tiêm (plan §4): mỗi ca đặt `onSleep` để đóng vai Runtime probe; mặc định chờ 25 ms thật. */
let onSleep: (() => Promise<void>) | null = null;
const sleep = async (_ms: number) => {
  if (onSleep) await onSleep();
  else await Bun.sleep(25);
};

let x: Ctx;
let log: ReturnType<typeof captureAll>;
beforeAll(async () => {
  x = await startH4b2({ fetch: fetchStub, sleep });
  log = captureAll();
}, 60_000);
afterAll(async () => {
  log?.restore();
  await x?.stop();
});

const check = (id: string): Promise<Res> => pa(x, "POST", `/providers/${id}/check`);
const callsSince = (n: number) => fetchStub.calls.slice(n);

describe("C01–C03 · vendor fake (trong tiến trình) [AC-H4b2-02 · D8 · plan §5]", () => {
  it("HUB-FR-66 · AC-H4b2-02 · C01 · key `fake-ok…` ⇒ 200 {status ok, error_code null, http_status 200, latency_ms, checked_at}; không gọi fetch", async () => {
    const d = await mkProvider(x, apiBody("qc-c01"));
    const n = fetchStub.calls.length;
    const r = await check(d.id);
    expect(r.status).toBe(200);
    await expectSchema("ProviderCheckResultSchema", r.json);
    expect(r.json).toMatchObject({ status: "ok", error_code: null, http_status: 200 });
    expect(typeof r.json.latency_ms).toBe("number");
    expect(callsSince(n)).toEqual([]);
    expectNoKey(r.text);
  });

  it("HUB-FR-66 · AC-H4b2-02 · C02 · key `fake-bad…` ⇒ error/auth_failed 401, message nguyên văn `invalid x-api-key (fake)`", async () => {
    const d = await mkProvider(x, apiBody("qc-c02", { secret_id: SEC.bad }));
    const r = await check(d.id);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      status: "error",
      error_code: "auth_failed",
      http_status: 401,
      message: "invalid x-api-key (fake)",
    });
    expectNoKey(r.text);
  });

  it("HUB-FR-69 · AC-H4b2-02 · C03 · audit `check` entity provider, after {status, error_code, http_status} KHÔNG message; KHÔNG bump hub_config_version", async () => {
    const d = await mkProvider(x, apiBody("qc-c03", { secret_id: SEC.bad }));
    const v0 = await versionOf(x.sql);
    const m = await auditMax(x.sql);
    expect((await check(d.id)).status).toBe(200);
    expect(await versionOf(x.sql)).toBe(v0);
    const rows = await auditSince(x.sql, m, { entityId: d.id });
    expect(rows.map((a) => [a.entity, a.action])).toEqual([["provider", "check"]]);
    expect(rows[0]?.after).toEqual({
      status: "error",
      error_code: "auth_failed",
      http_status: 401,
    });
    expect(JSON.stringify(rows[0])).not.toContain("invalid x-api-key");
    expectNoKey(JSON.stringify(rows));
  });
});

describe("C04–C09 · hãng thật qua fetch tiêm [Q3 · plan §2.2, §3.2 · D13]", () => {
  it("HUB-FR-66 · AC-H4b2-02 · C04 · openai vọng key trong lỗi 401 ⇒ auth_failed, message có `***`, không key, không chuỗi con ≥ 8; request đúng URL/Bearer/redirect error", async () => {
    const d = await mkProvider(x, apiBody("qc-c04", { vendor: "openai", secret_id: SEC.openai }));
    const n = fetchStub.calls.length;
    const r = await check(d.id);
    expect(r.json).toMatchObject({ status: "error", error_code: "auth_failed", http_status: 401 });
    expect(r.json.message).toContain("Incorrect API key provided");
    expect(r.json.message).toContain("***");
    expectNoKey(r.text);
    expectNoChunk(r.text, KEY.openai);
    const [c] = callsSince(n);
    expect(c?.url).toBe("https://api.openai.com/v1/models");
    expect(c?.headers.authorization).toBe(`Bearer ${KEY.openai}`);
    expect(c?.redirect).toBe("error");
  });

  it("HUB-FR-66 · C05 · anthropic 200 ⇒ ok; x-api-key + anthropic-version; base_url thay gốc", async () => {
    const d = await mkProvider(
      x,
      apiBody("qc-c05", {
        vendor: "anthropic",
        secret_id: SEC.anth,
        base_url: "https://proxy.example.test",
      }),
    );
    const n = fetchStub.calls.length;
    const r = await check(d.id);
    expect(r.json).toMatchObject({ status: "ok", http_status: 200 });
    const [c] = callsSince(n);
    expect(c?.url).toBe("https://proxy.example.test/v1/models");
    expect(c?.headers).toMatchObject({ "x-api-key": KEY.anth, "anthropic-version": "2023-06-01" });
  });

  it("HUB-FR-66 · C06 · google 500 ⇒ http_error, message nguyên văn; key ở header x-goog-api-key, không ở URL", async () => {
    const d = await mkProvider(x, apiBody("qc-c06", { vendor: "google", secret_id: SEC.google }));
    const n = fetchStub.calls.length;
    const r = await check(d.id);
    expect(r.json).toMatchObject({
      status: "error",
      error_code: "http_error",
      http_status: 500,
      message: "upstream exploded",
    });
    const [c] = callsSince(n);
    expect(c?.url).toBe("https://generativelanguage.googleapis.com/v1beta/models");
    expect(c?.url).not.toContain(KEY.google);
    expect(c?.headers["x-goog-api-key"]).toBe(KEY.google);
  });

  it("HUB-FR-66 · C07 · fetch ném TimeoutError ⇒ error/timeout; TypeError ⇒ error/network; http_status null", async () => {
    const a = await mkProvider(
      x,
      apiBody("qc-c07-a", {
        vendor: "openai",
        secret_id: SEC.openai,
        base_url: "https://slow.example.test",
      }),
    );
    const b = await mkProvider(
      x,
      apiBody("qc-c07-b", {
        vendor: "openai",
        secret_id: SEC.openai,
        base_url: "https://down.example.test",
      }),
    );
    expect((await check(a.id)).json).toMatchObject({
      status: "error",
      error_code: "timeout",
      http_status: null,
    });
    expect((await check(b.id)).json).toMatchObject({
      status: "error",
      error_code: "network",
      http_status: null,
    });
  });

  it("HUB-FR-66 · C08 · secret giải mã không được (bản mã khoá khác) ⇒ 200 error/secret_unreadable; không fetch", async () => {
    const d = await mkProvider(x, apiBody("qc-c08", { vendor: "openai", secret_id: SEC.broken }));
    const n = fetchStub.calls.length;
    const r = await check(d.id);
    expect(r.json).toMatchObject({ status: "error", error_code: "secret_unreadable" });
    expect(callsSince(n)).toEqual([]);
  });

  it("HUB-FR-66 · C09 · Hub thiếu HUB_SECRETS_KEY ⇒ 409 NOT_CONFIGURED; id lạ ⇒ 404", async () => {
    const d = await mkProvider(x, apiBody("qc-c09"));
    const hub2 = await startHubH3b(x.k, {
      instanceId: "qc-hub-h4b2-nokey",
      hubSecretsKey: null,
    } as never);
    try {
      const r = await call(hub2, "POST", `/studio/api/providers/${d.id}/check`, {
        token: await tok(x.k, "padmin"),
      });
      expect([r.status, errOf(r).code]).toEqual([409, "NOT_CONFIGURED"]);
    } finally {
      await hub2.stop();
    }
    expect([(await check(NONE)).status, errOf(await check(NONE)).code]).toEqual([404, "NOT_FOUND"]);
  });
});

describe('C10–C13 · subscription "Kiểm tra lại" [spec §3 A · D9 · plan §3.2]', () => {
  const PROBE_OLD = "2026-10-13T07:00:00.000Z";
  const stateOf = async (k: string): Promise<Json> => {
    const [s] =
      await x.sql`select status, last_probe_at, last_ok_at, updated_at, last_error from hub.provider_state
      where provider_key = ${k}`;
    return s ? { ...s } : undefined;
  };

  it("HUB-FR-66 · C10 · Hub đặt last_probe_at = NULL và last_ok_at = NULL, KHÔNG đổi updated_at; Runtime probe mới logged_out ⇒ error, message = last_error", async () => {
    const d = await mkProvider(x, subBody("qc-c10"));
    await setState(x.sql, "qc-c10", { status: "ok", probe: PROBE_OLD, lastOk: PROBE_OLD });
    const before = await stateOf("qc-c10");
    let seen: Json;
    onSleep = async () => {
      if (seen) return;
      seen = await stateOf("qc-c10");
      await x.sql`update hub.provider_state set status = 'logged_out', last_probe_at = now(),
        last_error = 'Not logged in · Please run claude login' where provider_key = 'qc-c10'`;
    };
    try {
      const r = await check(d.id);
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({
        status: "error",
        message: "Not logged in · Please run claude login",
      });
    } finally {
      onSleep = null;
    }
    expect(seen?.last_probe_at).toBeNull();
    expect(seen?.last_ok_at).toBeNull();
    expect(seen?.updated_at?.toISOString?.()).toBe(before?.updated_at?.toISOString?.());
  });

  it("HUB-FR-66 · C11 · probe mới status ok / busy ⇒ ok", async () => {
    for (const status of ["ok", "busy"]) {
      const key = `qc-c11-${status}`;
      const d = await mkProvider(x, subBody(key));
      await setState(x.sql, key, { status: "error", probe: PROBE_OLD, lastError: "old" });
      onSleep = async () => {
        await x.sql`update hub.provider_state set status = ${status}, last_probe_at = now(), last_error = null
          where provider_key = ${key}`;
      };
      try {
        expect([status, (await check(d.id)).json?.status]).toEqual([status, "ok"]);
      } finally {
        onSleep = null;
      }
    }
  });

  it("HUB-FR-66 · C12 · không có probe mới trong 10 s ⇒ status requested; không fetch", async () => {
    const d = await mkProvider(x, subBody("qc-c12"));
    await setState(x.sql, "qc-c12", { status: "ok", probe: PROBE_OLD });
    const n = fetchStub.calls.length;
    const r = await check(d.id);
    expect(r.status).toBe(200);
    expect(r.json?.status).toBe("requested");
    expect(callsSince(n)).toEqual([]);
  }, 30_000);

  it("HUB-FR-66 · C13 · audit check subscription không bump; trả kết quả hợp schema", async () => {
    const d = await mkProvider(x, subBody("qc-c13"));
    const v0 = await versionOf(x.sql);
    const m = await auditMax(x.sql);
    onSleep = async () => {
      await x.sql`insert into hub.provider_state (provider_key, status, last_probe_at)
        values ('qc-c13', 'ok', now()) on conflict (provider_key) do update set last_probe_at = now(), status = 'ok'`;
    };
    try {
      const r = await check(d.id);
      await expectSchema("ProviderCheckResultSchema", r.json);
      expect(r.json?.status).toBe("ok");
    } finally {
      onSleep = null;
    }
    expect(await versionOf(x.sql)).toBe(v0);
    expect((await auditSince(x.sql, m, { entityId: d.id })).map((a) => a.action)).toEqual([
      "check",
    ]);
  });
});

describe("C14 · không lộ key ở log [AC-H4b2-02 · plan §5]", () => {
  it("HUB-FR-66 · AC-H4b2-02 · C14 · log Hub + console sau mọi lần kiểm không chứa giá trị key nào (kể cả chuỗi con ≥ 8 của key openai)", () => {
    const text = log.lines.join("\n");
    // điều kiện dương: log kiểm tra có `provider_key` (plan §3.2 "Log: {provider_key, status, …}")
    expect(text).toContain("qc-c04");
    expectNoKey(text);
    expectNoChunk(text, KEY.openai);
  });
});
