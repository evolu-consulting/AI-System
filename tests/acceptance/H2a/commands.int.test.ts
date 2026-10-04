// HUB-FR-10, HUB-FR-14, HUB-FR-76 · HUB-BR-01, HUB-BR-06 · AC-H02, AC-H05, AC-H11 · HUB-H2a-AC-09, HUB-H2a-AC-10 ·
// test-plan H2a §5 A01–A09: menu `GET /commands`, ẩn lệnh không quyền, cập nhật ≤ 5 s, `CMD_NOT_FOUND` + gợi ý, `/` và
// `//`, đối chiếu quyền Admin trên cùng dữ liệu SQL. Hộp đen: HTTP hub-api thật + DB riêng + Redis DB 15 + mock Dify MK.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  CHAT_COMMAND_ERRORS,
  CmdNotFoundDetailsSchema,
  CommandMenuResponseSchema,
  ErrorResponseSchema,
} from "@ai/contracts/chat";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import {
  call,
  counts,
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
  waitFor,
} from "../H1/_fixtures";
import {
  block,
  type HubX,
  insertConv,
  insertHubConfig,
  runIdOf,
  send,
  testRedis,
} from "../H1/_hub";
import { echoAnswer, ScriptRuntime } from "../H1/_runtime";
import {
  adminVisible,
  CMD,
  catalogChange,
  type Dify,
  FEAT,
  GRP,
  idGen2,
  insertCatalog,
  menuNames,
  setAppKey,
  startDify,
  startHubH2a,
  WF,
} from "./_h2a";

let sql: Sql;
let k: Keys;
let hub: HubX;
let redis: Redis;
let rt: ScriptRuntime;
let dify: Dify;
const id = idGen2(1000);

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  dify = startDify();
  await insertCatalog(sql, { baseUrl: dify.baseUrl });
  k = await makeKeys();
  hub = await startHubH2a(k);
  redis = await testRedis();
  rt = new ScriptRuntime(sql, redis);
}, 60_000);
afterAll(async () => {
  await hub?.stop();
  await dify?.close();
  redis?.disconnect();
  await sql?.end();
});

const tok = (who: UserKey) => sign(k, USERS[who]);
const menu = async (who: UserKey) => menuNames(hub, await tok(who));
/** Chờ menu của `who` thoả `ok` (poll 100 ms, ≤ 5 000 ms — Q-T6); trả menu cuối + thời gian đo. */
async function menuUntil(who: UserKey, ok: (m: string[] | null) => boolean) {
  const t0 = Date.now();
  const m = await waitFor(() => menu(who), ok, 5_000);
  return { m, ms: Date.now() - t0 };
}
/** E12 trên hội thoại mới, chỉ lấy status + body JSON (lỗi trước SSE); đóng stream nếu là SSE. */
async function sendOnce(who: UserKey, content: string) {
  const conv = await insertConv(sql, who, id());
  const s = await send(hub, await tok(who), conv, content);
  s.close();
  return s;
}
function keysDeep(v: Json, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) for (const x of v) keysDeep(x, out);
  else if (v && typeof v === "object")
    for (const [kk, x] of Object.entries(v)) {
      out.add(kk);
      keysDeep(x, out);
    }
  return out;
}

describe("A01–A03 · menu GET /commands [HUB-FR-10 · AC-H11 · AC-H05]", () => {
  it("A01 · lan: 200 CommandMenuResponse, đúng {dich, hoi, so} sắp name; không khoá workflow/secret/input_map; args required/has_fallback/rest đúng; không JWT → 401 AUTH_EXPIRED [HUB-FR-10]", async () => {
    const res = await call(hub, "GET", "/commands", { token: await tok("lan") });
    expect(res.status).toBe(200);
    const p = CommandMenuResponseSchema.safeParse(res.json);
    expect(p.success).toBe(true);
    const items = p.success ? p.data.items : [];
    expect(items.map((i) => i.name)).toEqual(["dich", "hoi", "so"]);
    const keys = keysDeep(res.json);
    for (const bad of [
      "workflow",
      "workflow_id",
      "base_url",
      "secret",
      "secret_id",
      "input_map",
      "api",
    ])
      expect(keys.has(bad)).toBe(false);
    const dich = items.find((i) => i.name === "dich");
    expect(dich?.aliases).toEqual(["translate"]);
    expect(dich?.args.map((x) => [x.name, x.required, x.has_fallback, x.rest])).toEqual([
      ["lang", true, false, false],
      ["text", false, true, true],
    ]);
    const hoi = items.find((i) => i.name === "hoi");
    expect(hoi?.args.map((x) => [x.name, x.required, x.has_fallback, x.rest])).toEqual([
      ["q", true, false, true],
    ]);
    const so = items.find((i) => i.name === "so");
    expect(so?.args.map((x) => [x.name, x.required, x.has_fallback, x.rest])).toEqual([
      ["n", true, false, false],
      ["flag", false, false, false],
    ]);
    const anon = await call(hub, "GET", "/commands");
    expect(anon.status).toBe(401);
    expect(ErrorResponseSchema.safeParse(anon.json).data?.error.code).toBe("AUTH_EXPIRED");
  });

  it("A02 · /tom (không entitlement), /tat (workflow tắt), /dong (command tắt) không có trong menu lan; tadmin chỉ {hoi}; an (beta) = {dich, hoi, so} [AC-H11]", async () => {
    const lan = await menu("lan");
    expect(lan).not.toBeNull();
    for (const hidden of ["tom", "tat", "dong"]) expect(lan ?? []).not.toContain(hidden);
    expect(await menu("tadmin")).toEqual(["hoi"]);
    expect(await menu("an")).toEqual(["dich", "hoi", "so"]);
  });

  it("A03 · tắt command /dich → mất khỏi menu ≤ 5 000 ms, bật lại → có lại ≤ 5 s; tắt feature translate → mất /dich (so còn nhờ labs) [AC-H05 · HUB-BR-06]", async () => {
    expect(await menu("lan")).toContain("dich");
    try {
      await catalogChange(
        sql,
        (tx) => tx`update admin.commands set enabled = false where id = ${CMD.dich}`,
      );
      const off = await menuUntil("lan", (m) => m !== null && !m.includes("dich"));
      expect(off.m).not.toContain("dich");
      expect(off.ms).toBeLessThanOrEqual(5_000);
      await catalogChange(
        sql,
        (tx) => tx`update admin.commands set enabled = true where id = ${CMD.dich}`,
      );
      const on = await menuUntil("lan", (m) => m?.includes("dich") === true);
      expect(on.m).toContain("dich");
      expect(on.ms).toBeLessThanOrEqual(5_000);
      await catalogChange(
        sql,
        (tx) => tx`update admin.features set status = 'off' where id = ${FEAT.translate}`,
      );
      const f = await menuUntil("lan", (m) => m !== null && !m.includes("dich"));
      expect(f.m).not.toContain("dich");
      expect(f.m).toContain("so");
    } finally {
      await catalogChange(sql, async (tx) => {
        await tx`update admin.commands set enabled = true where id = ${CMD.dich}`;
        await tx`update admin.features set status = 'on' where id = ${FEAT.translate}`;
      });
    }
  });

  it("A04 · run /dich đang chạy (mk-slow-300) → tắt /dich giữa chừng → SSE vẫn run.finished đủ nội dung; tin /dich mới sau ≤ 5 s → 404 [AC-H05]", async () => {
    await setAppKey(sql, "dich", "mk-slow-300");
    dify.mock.reset();
    const conv = await insertConv(sql, "lan", id());
    const s = await send(hub, await tok("lan"), conv, "/dich en xin chào");
    try {
      expect(s.status).toBe(200);
      expect(await s.until((e) => e.event === "delta", 5_000)).toBeDefined();
      await catalogChange(
        sql,
        (tx) => tx`update admin.commands set enabled = false where id = ${CMD.dich}`,
      );
      const end = await s.terminal(10_000);
      expect(end?.event).toBe("run.finished");
      expect(end?.data?.content).toBe("Xin chào, đây là mock.");
      const t0 = Date.now();
      const last = await waitFor(
        () => sendOnce("lan", "/dich en lần nữa"),
        (x) => x.status === 404,
        5_000,
      );
      expect(last.status).toBe(404);
      expect(Date.now() - t0).toBeLessThanOrEqual(5_500);
    } finally {
      s.close();
      await setAppKey(sql, "dich", "mk-ok");
      await catalogChange(
        sql,
        (tx) => tx`update admin.commands set enabled = true where id = ${CMD.dich}`,
      );
      await menuUntil("lan", (m) => m?.includes("dich") === true);
    }
  });
});

describe("A05–A07 · CMD_NOT_FOUND + gợi ý [HUB-FR-14 · AC-H02 · HUB-BR-01]", () => {
  it("A05 · /dihc xin → 404 CMD_NOT_FOUND {suggestions:[dich]}; không ghi messages/runs/jobs; MK 0 lời gọi [AC-H02]", async () => {
    const conv = await insertConv(sql, "lan", id());
    const before = await counts(sql);
    dify.mock.reset();
    const s = await send(hub, await tok("lan"), conv, "/dihc xin");
    s.close();
    expect(s.status).toBe(CHAT_COMMAND_ERRORS.CMD_NOT_FOUND);
    const e = ErrorResponseSchema.safeParse(s.json);
    expect(e.data?.error.code).toBe("CMD_NOT_FOUND");
    expect(e.data?.error.message).toBe("Command not found");
    expect(CmdNotFoundDetailsSchema.safeParse(e.data?.error.details).data).toEqual({
      suggestions: ["dich"],
    });
    const after = await counts(sql);
    expect({ m: after.messages, r: after.runs, j: after.jobs, f: after.flows }).toEqual({
      m: before.messages,
      r: before.runs,
      j: before.jobs,
      f: before.flows,
    });
    expect(dify.runs().length).toBe(0);
  });

  it("A06 · '/' và '/ abc' → 404 suggestions []; '   /dich en xin' (khoảng trắng đầu) → chạy command (MK nhận 1 lời gọi) [HUB-BR-01]", async () => {
    for (const content of ["/", "/ abc"]) {
      const s = await sendOnce("lan", content);
      expect(s.status).toBe(404);
      expect(s.json?.error?.code).toBe("CMD_NOT_FOUND");
      expect(s.json?.error?.details).toEqual({ suggestions: [] });
    }
    dify.mock.reset();
    const conv = await insertConv(sql, "lan", id());
    const s = await send(hub, await tok("lan"), conv, "   /dich en xin");
    try {
      expect(s.status).toBe(200);
      await s.terminal(8_000);
      expect(dify.runs().length).toBe(1);
      expect(dify.runs()[0]?.body).toMatchObject({
        inputs: { target_lang: "en", source_text: "xin" },
      });
    } finally {
      s.close();
    }
  });

  it("A07 · không tồn tại / không quyền (/tom) / tắt (/dong) / workflow tắt (/tat) → cùng status + body; /tomm không gợi ý tom [H2a-R03]", async () => {
    const r = async (c: string) => {
      const s = await sendOnce("lan", c);
      return { status: s.status, body: JSON.stringify(s.json) };
    };
    const none = await r("/zzz");
    expect(none.status).toBe(404);
    expect(await r("/dong")).toEqual(none);
    expect(await r("/tat")).toEqual(none);
    const tox = await r("/tox");
    expect(tox.status).toBe(404);
    expect(await r("/tom")).toEqual(tox);
    const tomm = await sendOnce("lan", "/tomm");
    expect(tomm.status).toBe(404);
    expect(tomm.json?.error?.details?.suggestions).toBeArray();
    expect(tomm.json?.error?.details?.suggestions).not.toContain("tom");
  });
});

describe("A08 · quyền Hub = Admin trên cùng dữ liệu SQL [HUB-FR-76 · HUB-H2a-AC-10]", () => {
  const WHO: UserKey[] = ["lan", "hoa", "tadmin", "an"];
  const variants: {
    name: string;
    apply: (tx: Sql) => Promise<unknown>;
    undo: (tx: Sql) => Promise<unknown>;
  }[] = [
    { name: "gốc", apply: async () => {}, undo: async () => {} },
    {
      name: "labs on (hết beta)",
      apply: (tx) => tx`update admin.features set status = 'on' where id = ${FEAT.labs}`,
      undo: (tx) => tx`update admin.features set status = 'beta' where id = ${FEAT.labs}`,
    },
    {
      name: "thu hồi entitlement translate acme",
      apply: (tx) => tx`update admin.feature_entitlements set revoked_at = now()
        where feature_id = ${FEAT.translate} and tenant_id = ${USERS.lan.tid}`,
      undo: (tx) => tx`update admin.feature_entitlements set revoked_at = null
        where feature_id = ${FEAT.translate} and tenant_id = ${USERS.lan.tid}`,
    },
    {
      name: "workflow dich tắt",
      apply: (tx) => tx`update admin.workflows set enabled = false where id = ${WF.dich}`,
      undo: (tx) => tx`update admin.workflows set enabled = true where id = ${WF.dich}`,
    },
  ];
  it.each(variants.map((v) => [v.name, v] as const))(
    "A08 · biến thể %s: GET /commands của lan, hoa, tadmin, an = visible của computeEffectiveAccess Admin [HUB-H2a-AC-10]",
    async (_name, v) => {
      try {
        await catalogChange(sql, (tx) => v.apply(tx as unknown as Sql));
        for (const who of WHO) {
          const want = await adminVisible(sql, who);
          const got = await waitFor(
            () => menu(who),
            (m) => JSON.stringify(m) === JSON.stringify(want),
            5_000,
          );
          expect({ who, got }).toEqual({ who, got: want });
        }
      } finally {
        await catalogChange(sql, (tx) => v.undo(tx as unknown as Sql));
      }
    },
  );
});

describe("A09 · '//' là tin thường; thu hồi grant ẩn lệnh ≤ 5 s [HUB-H2a-AC-09]", () => {
  it("A09 · //abc → job Orchestrator nhận <message> = /abc, messages.content = /abc; thu hồi grant translate → ≤ 5 s → /dich en → 404 [HUB-H2a-AC-09]", async () => {
    const conv = await insertConv(sql, "lan", id());
    const s = await send(hub, await tok("lan"), conv, "//abc");
    try {
      expect(s.status).toBe(200);
      const job = await rt.next(runIdOf(s));
      const msg = (block(job.payload.prompt, "message") ?? "").trim();
      expect(["/abc", JSON.stringify("/abc")]).toContain(msg);
      await rt.decide(job, echoAnswer(job));
      expect((await s.terminal())?.event).toBe("run.finished");
    } finally {
      s.close();
    }
    const [m] = await sql<{ content: string }[]>`select content from hub.messages
      where conversation_id = ${conv} and role = 'user'`;
    expect(m?.content).toBe("/abc");
    expect(await menu("lan")).toContain("dich");
    try {
      await catalogChange(
        sql,
        (tx) => tx`delete from admin.feature_grants
        where feature_id = ${FEAT.translate} and group_id = ${GRP.staff}`,
      );
      const off = await menuUntil("lan", (x) => x !== null && !x.includes("dich"));
      expect(off.m).not.toContain("dich");
      const r = await sendOnce("lan", "/dich en xin");
      expect(r.status).toBe(404);
      expect(r.json?.error?.code).toBe("CMD_NOT_FOUND");
    } finally {
      await catalogChange(
        sql,
        (tx) => tx`insert into admin.feature_grants (tenant_id, feature_id, group_id)
        values (${USERS.lan.tid}, ${FEAT.translate}, ${GRP.staff})`,
      );
    }
  });
});
