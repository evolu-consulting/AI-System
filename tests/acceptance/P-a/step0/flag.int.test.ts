// HUB-FR-105 · HUB-BR-28 · HUB-BR-25 · D15 · D16 · M2 · C1 · S0-10…S0-13 (test-plan-int §1): cờ `processEngine` off ⇒ không
// mount (404) + `!` là chữ (xanh trước code — chủ ý); `!!` bỏ một `!`; hội thoại nền không lộ; `/me/stream` chuyển
// `process.updated`. Phần "Hỏi AI qua đường SSE cũ" của S0-10/S0-11 thuộc test khoá H1/X2b (không lặp ở đây).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { USER_STREAM_FIELD, userStreamKey } from "../../../../apps/hub-api/src/lib/user-stream";
import { openMeStream } from "../../X2a/_x2a";
import { fn, loadChat } from "../_support/modules";
import {
  api,
  type CtxPa,
  DEF_HD,
  type HubPa,
  insertDef,
  insertRun,
  PA,
  PA_FIX,
  postRoom,
  startHubPa,
  startPa,
  T,
} from "../_support/pa";
import { needSchema, tableExists } from "../_support/schema";

let c: CtxPa; // cờ on
let off: HubPa; // cùng DB, cờ off
beforeAll(async () => {
  c = await startPa();
  off = await startHubPa(c.k, { flag: false, instanceId: "qc-pa-off" });
  if (c.ready) await insertDef(c.sql, { id: PA_FIX.defHoaDon, tenantId: T.acme });
}, 60_000);
afterAll(async () => {
  await off?.stop();
  await c?.stop();
});

const processRuns = async (): Promise<number> => {
  if (!(await tableExists(c.sql, "hub.process_runs"))) return 0;
  const [r] = await c.sql`select count(*)::int as n from hub.process_runs`;
  return Number(r?.n ?? 0);
};

describe("S0-10…S0-13 · cờ + `!!` + C1 + /me/stream [D15]", () => {
  it("HUB-FR-105 · S0-10 · cờ off: 8 endpoint ⇒ 404; `!hoa-don x` ở R ⇒ 201 tin thường, không header, 0 run (xanh trước code — chủ ý)", async () => {
    const tok = await c.tok("A");
    const adm = await c.tok("Adm");
    const eps: [string, string, string, unknown?][] = [
      [tok, "GET", "/processes"],
      [
        tok,
        "POST",
        "/process-runs",
        { process_key: "hoa-don-t", input: "", origin: { kind: "none" } },
      ],
      [tok, "GET", `/process-runs/${PA_FIX.defHoaDon}`],
      [tok, "POST", `/review-tasks/${PA_FIX.defHoaDon}/decision`, { result: "pass" }],
      [tok, "GET", "/me/review-tasks"],
      [tok, "GET", "/me/process-inbox"],
      [adm, "GET", "/process-defs"],
      [adm, "GET", "/agent-teams"],
    ];
    for (const [t, m, p, b] of eps)
      expect({ p, s: (await api(off, t, m, p, b)).status }).toEqual({ p, s: 404 });
    const res = await api(off, tok, "POST", `/rooms/${PA_FIX.room}/messages`, {
      client_msg_id: `a5a00000-0000-4000-8000-${String(990_001).padStart(12, "0")}`,
      content: "!hoa-don x",
    });
    expect(res.status).toBe(201);
    expect(res.json?.content).toBe("!hoa-don x");
    expect(res.headers.get("x-process-run-id")).toBeNull();
    expect(await processRuns()).toBe(0);
  });
  it("HUB-BR-28 · S0-11 · cờ on: `!!abc` ở phòng ⇒ 201 nội dung `!abc`, 0 run", async () => {
    needSchema(c.ready);
    const s = await postRoom(c, "A", PA_FIX.room, { content: "!!abc" });
    expect(s.res.status).toBe(201);
    expect(s.res.json?.content).toBe("!abc");
    expect(s.processRunId).toBeNull();
    expect(await processRuns()).toBe(0);
  });
  it("HUB-BR-25 · S0-12 · hội thoại nền (`process_run_id`) không trong GET /conversations; GET/POST /conversations/:id ⇒ 404", async () => {
    needSchema(c.ready);
    const run = await insertRun(c.sql, { def: DEF_HD(PA_FIX.defHoaDon), startedBy: PA.A });
    const list = await c.call("A", "GET", "/conversations");
    expect(list.status).toBe(200);
    expect((list.json?.items ?? []).map((x: { id: string }) => x.id)).not.toContain(run.convId);
    expect((await c.call("A", "GET", `/conversations/${run.convId}`)).status).toBe(404);
    expect(
      (await c.call("A", "POST", `/conversations/${run.convId}/messages`, { content: "xin chào" }))
        .status,
    ).toBe(404);
  });
  it("HUB-FR-112 · S0-13 · /me/stream chuyển `process.updated` (XADD tay) parse được; sự kiện X2a vẫn đến", async () => {
    const parse = fn(await loadChat(), "parseMeStreamProcessEvent");
    const me = await openMeStream(c.hub, await c.tok("A"));
    try {
      const data = { process_run_id: PA_FIX.defAuto, status: "running", stage_idx: 0 };
      await c.redis.xadd(
        userStreamKey(PA.A.id),
        "*",
        USER_STREAM_FIELD,
        JSON.stringify({ event: "process.updated", data }),
      );
      const ev = await me.until((e) => e.event === "process.updated", 5_000);
      expect(ev?.event).toBe("process.updated");
      expect(parse("process.updated", ev?.data)).not.toBeNull();
      await postRoom(c, "B", PA_FIX.room, { content: "Tin X2a vẫn đến" });
      const m = await me.until((e) => e.event === "room.message", 5_000);
      expect(m?.event).toBe("room.message");
    } finally {
      me.close();
    }
  });
});
