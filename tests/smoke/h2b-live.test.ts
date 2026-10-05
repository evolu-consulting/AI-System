// HUB-H2b-AC-12 · H2b-R29 (F7) · WRK-FR-03 · WRK-FR-17 · test-plan-py H2b §4 SM1–SM3: smoke Hub thật + Runtime + `claude-sub`
// thật (`bun run test:smoke:live`, chỉ chạy khi `HUB_LIVE=1`; vắng cờ → mọi ca skip). Không chặn `done:h2b`, không khoá
// (Q-T6) — I2 chỉnh theo kết quả spike. Kỳ vọng theo `spike-stream.md`: chỉ "≥ 1 `delta` khi step còn mở", KHÔNG ngưỡng độ
// trễ (S5: agent có thể im ~8 s do thinking); usage khi huỷ = cận dưới (spike #9).
// Env: `HUB_URL` (Hub thật), `AUTH_URL` (vắng → `ADMIN_API_URL` → `HUB_URL`), `SMOKE_USER` (JSON `{tenant_key, username,
// password}`; vắng → `lan`/acme mật khẩu dev), `SMOKE_TOKEN` (JWT có sẵn — có thì bỏ đăng nhập; DB smoke fixture không
// có admin-api), `DATABASE_URL` (owner, chỉ đọc `hub.usage_logs` cho SM3). Mỗi ca in số đo (không nội dung).
import { describe, expect, it } from "bun:test";
import postgres from "postgres";

const env = (k: string) => process.env[k]?.trim() || undefined;
/** F7 (R29): `HUB_LIVE` có giá trị khác "0" — như `smokeEnabled` của `tools/scripts/src/smoke-live.ts`. */
const LIVE = (env("HUB_LIVE") ?? "0") !== "0";
const HUB = (env("HUB_URL") ?? "http://localhost:3200").replace(/\/+$/, "");
const AUTH = (env("AUTH_URL") ?? env("ADMIN_API_URL") ?? HUB).replace(/\/+$/, "");
const USER = env("SMOKE_USER")
  ? JSON.parse(env("SMOKE_USER") as string)
  : { tenant_key: "acme", username: "lan", password: "dev-password-1" };

type Ev = { id: number | null; event: string; data: Record<string, unknown> | null; t: number };

async function login(): Promise<string> {
  const pre = env("SMOKE_TOKEN");
  if (pre) return pre;
  const res = await fetch(`${AUTH}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(USER),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function api(token: string, method: string, path: string, body?: unknown) {
  return fetch(`${HUB}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function parseFrame(raw: string): Ev | null {
  let id: number | null = null;
  let event = "message";
  const data: string[] = [];
  for (const line of raw.split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const v = line.slice(i + 1).replace(/^ /, "");
    if (line.startsWith("id:")) id = Number(v);
    else if (line.startsWith("event:")) event = v;
    else if (line.startsWith("data:")) data.push(v);
  }
  return data.length ? { id, event, data: JSON.parse(data.join("\n")), t: 0 } : null;
}

/** Gửi tin vào hội thoại mới; đọc SSE tới sự kiện kết thúc; `onEvent` có thể huỷ run giữa chừng. */
async function ask(
  token: string,
  content: string,
  onEvent?: (e: Ev, runId: string) => Promise<void>,
): Promise<{ events: Ev[]; runId: string }> {
  const conv = await api(token, "POST", "/conversations", { title: `smoke h2b ${Date.now()}` });
  const convId = ((await conv.json()) as { id: string }).id;
  const t0 = performance.now();
  const res = await api(token, "POST", `/conversations/${convId}/messages`, { content });
  expect(res.status).toBe(200);
  const runId = res.headers.get("x-run-id") ?? "";
  const events: Ev[] = [];
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    const frames = buf.split("\n\n");
    buf = frames.pop() ?? "";
    for (const f of frames) {
      const e = parseFrame(f);
      if (!e) continue;
      e.t = Math.round(performance.now() - t0);
      events.push(e);
      await onEvent?.(e, runId);
    }
    if (events.some((e) => e.event === "run.finished" || e.event === "run.failed")) break;
  }
  await reader.cancel().catch(() => undefined);
  const deltas = events.filter((e) => e.event === "delta");
  const at = (n: string) => events.find((e) => e.event === n)?.t;
  console.log(
    `[smoke] run=${runId} events=${events
      .map((e) => e.event)
      .filter((n) => n !== "delta")
      .join(",")} ` +
      `delta=${deltas.length} chars=${deltas.reduce((a, e) => a + String(e.data?.text ?? "").length, 0)} ` +
      `firstDelta=${deltas[0]?.t}ms lastDelta=${deltas.at(-1)?.t}ms stepFinished=${at("step.finished")}ms ` +
      `end=${events.at(-1)?.t}ms responder=${JSON.stringify(events.find((e) => e.event === "run.started")?.data?.responder ?? null)}`,
  );
  return { events, runId };
}

/** ≥ 1 `delta` tới khi step cuối còn mở (trước `step.finished` cuối cùng). */
function expectEarlyDelta(events: Ev[]): void {
  const firstDelta = events.findIndex((e) => e.event === "delta");
  const lastStepEnd = events.map((e) => e.event).lastIndexOf("step.finished");
  expect(firstDelta).toBeGreaterThanOrEqual(0);
  expect(lastStepEnd).toBeGreaterThanOrEqual(0);
  expect(firstDelta).toBeLessThan(lastStepEnd);
}

const LONG = "Viết một bài khoảng 800 ký tự về lợi ích của việc đi bộ mỗi ngày, chia 3 đoạn.";

describe.if(LIVE)("SM1–SM3 · smoke H2b claude-sub thật [HUB-H2b-AC-12 · H2b-R29]", () => {
  it("WRK-FR-03 · SM1 · '@assistant' câu trả lời ~800 ký tự → ≥ 1 delta trước step.finished (job.delta trước job.result) [HUB-H2b-AC-12]", async () => {
    const { events } = await ask(await login(), `@assistant ${LONG}`);
    expect(events.at(-1)?.event).toBe("run.finished");
    expect(
      (events.find((e) => e.event === "run.started")?.data?.responder as { key?: string })?.key,
    ).toBe("assistant");
    expectEarlyDelta(events);
  });

  it("WRK-FR-03 · SM2 · Orchestrator answer dài → ≥ 1 delta khi step Orchestrator cuối còn mở (trước run.finished) [HUB-H2b-AC-12]", async () => {
    const { events } = await ask(await login(), `Tự trả lời trực tiếp, không cần agent: ${LONG}`);
    expect(events.at(-1)?.event).toBe("run.finished");
    expectEarlyDelta(events);
  });

  it("WRK-FR-17 · SM3 · huỷ sau lượt có tool → usage_logs 1 dòng token > 0 (cận dưới, không so tổng thật) [HUB-H2b-AC-12 · spike #9]", async () => {
    const token = await login();
    // Huỷ ở delta đầu HOẶC `SMOKE_CANCEL_MS` (mặc định 12 000) sau `run.started` — tuỳ cái nào trước: agent dùng
    // `StructuredOutput` có thể dồn mọi delta về cuối job (smoke I2), khi đó huỷ theo delta không còn "giữa chừng".
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = async (id: string) => {
      if (cancelled) return;
      cancelled = true;
      clearTimeout(timer);
      await api(token, "POST", `/runs/${id}/cancel`);
    };
    const { events, runId } = await ask(
      token,
      "@assistant Dùng công cụ đọc danh sách file trong thư mục làm việc, rồi viết bài 1500 từ mô tả từng file.",
      async (e, id) => {
        if (e.event === "run.started" && !timer)
          timer = setTimeout(() => void cancel(id), Number(env("SMOKE_CANCEL_MS") ?? 12_000));
        if (e.event === "delta") await cancel(id);
      },
    );
    clearTimeout(timer);
    expect(events.at(-1)?.event).toBe("run.failed");
    expect(events.at(-1)?.data?.code).toBe("CANCELLED");
    const db = postgres(env("DATABASE_URL") as string, { max: 1, onnotice: () => {} });
    try {
      let rows: { input_tokens: number; output_tokens: number }[] = [];
      for (let i = 0; i < 60 && rows.length === 0; i++) {
        rows =
          await db`select input_tokens, output_tokens from hub.usage_logs where run_id = ${runId}`;
        if (rows.length === 0) await Bun.sleep(500);
      }
      console.log(`[smoke] SM3 usage_logs=${JSON.stringify(rows)}`);
      expect(rows.length).toBe(1);
      expect((rows[0]?.input_tokens ?? 0) + (rows[0]?.output_tokens ?? 0)).toBeGreaterThan(0);
    } finally {
      await db.end();
    }
  });
});
