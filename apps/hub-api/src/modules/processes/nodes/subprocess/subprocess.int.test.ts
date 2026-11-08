// CR-125 · node «Quy trình con» — đường thật (role `hub_api`, launcher thật, trigger 0129, vòng hẹn giờ `fireTimer`): lượt cha mở MỘT lượt
// con ⇒ con xong ⇒ cha đi tiếp đầu ra `done` kèm dữ liệu `sub_*`; con kết thúc Từ chối ⇒ cha rẽ `rejected`; huỷ cha ⇒ con bị huỷ; kick lại /
// đưa stage về hàng đợi không mở lượt con thứ hai; con lỗi ⇒ bước cha «Cần xử lý»; lưu def trỏ quy trình không có / gọi vòng / lồng quá 3 ⇒ 422.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Role } from "@ai/contracts/common";
import type { ProcessDefInput } from "@ai/contracts/hub-admin";
import { withHubScope } from "@ai/db/hub-scope";
import { users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../../../lib/auth.middleware";
import { connectDb, type Db } from "../../../../lib/db";
import { AppError } from "../../../../lib/errors";
import { createHubUow } from "../../adapters/hub-uow";
import { fireTimer } from "../../application/timers/fire-timer.usecase";
import * as core from "../../core/core.repo";
import type { ProcessBgDeps, ProcessDeps } from "../../core/ports";
import { subprocessCheck } from "../../defs/subprocess-check";
import { cancelEnd } from "../../gates/gates.effects";
import { actorRef } from "../../gates/gates.repo";
import { expireRuns } from "../../runs/expire";
import { createStageLauncher } from "../../runs/launcher";
import { StartService } from "../../runs/start.service";

const T = "00000000-0000-4000-8000-000000012501";
let A = "";
let o: Sql;
let db: Db;
let d: ProcessDeps;

const base = (key: string, name: string, step: number, fields: string[] = []) => ({
  key,
  name,
  step,
  instruction: "",
  output: {
    filename: `${key}.md`,
    template: "x",
    required_sections: ["x"],
    fields: fields.map((k) => ({ key: k, type: "string", required: false })),
  },
  real_action: false,
  answerer: { kind: "starter" },
  token_budget: null,
  after: { kind: "auto", branch: [] },
});
const end = (key: string, step: number, outcome: string) => ({
  ...base(key, key, step),
  executor: { kind: "set", values: [] },
  outcome,
});
const sub = (defKey: string) => ({
  ...base("phase", "Giai đoạn mua", 0, ["outcome"]),
  executor: {
    kind: "subprocess",
    def_key: defKey,
    input_map: { amount: "amount" }, // id nguồn autoMapInputs: khoá «Bắt đầu khi» = đầu vào lượt
    branches: [
      { on: "rejected", goto_step: 2 },
      { on: "cancelled", goto_step: 2 },
    ],
  },
});
const AMOUNT = [{ key: "amount", label: "Số tiền", type: "text", required: false }];
/** Cha: 0 Quy trình con (rejected/cancelled ⇒ 2) · 1 Kết thúc approved · 2 Kết thúc rejected. */
const parentStages = (defKey: string) => [
  sub(defKey),
  end("ok", 1, "approved"),
  end("no", 2, "rejected"),
];

async function def(key: string, stages: unknown[], inputs: unknown[] = []): Promise<string> {
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, inputs, enabled)
    values (${T}, ${key}, ${key}, ${o.json(stages as never)}, ${o.json(inputs as never)}, true) returning id`;
  return r?.id as string;
}

const pipe: unknown = new Proxy(
  {},
  { get: (_, k) => (k === "exec" ? async () => [] : () => pipe) },
);
function mkDeps(): ProcessDeps {
  const x = {
    db,
    config: {
      user: async () => ({ active: true, groupIds: new Set<string>() }),
      poll: async () => {},
      snapshot: async () => null,
      catalog: async () => ({ features: [], entitled: new Set(), grantGroups: new Map() }),
    },
    redis: { pipeline: () => pipe },
    notifier: new Proxy({}, { get: () => async () => [] }),
    log: { warn: () => {}, info: () => {}, error: () => {} },
    now: () => new Date(),
    runsPerTenant: 100,
    postThread: async () => {},
  } as unknown as ProcessDeps & { launcher: unknown };
  x.launcher = createStageLauncher(x as never);
  return x;
}
const u = (): AuthUser => ({ tenantId: T, userId: A, role: "tenant_admin" as Role }) as AuthUser;

async function start(parentDefId: string, amount = "1200"): Promise<string> {
  const s = new StartService(d);
  const r = await s.fromAdmin(u(), parentDefId, "", [
    { type: "text", key: "amount", text: amount },
  ]);
  return r.id;
}
const uow = () =>
  createHubUow(db, {
    clock: { now: () => new Date() },
    notifier: { runFinished: async () => [], runsFinished: async () => [] } as never,
    publish: async (evs) => {
      for (const e of evs) if (e.kind === "kick") await d.launcher.kick(e.runId);
    },
  });
/** Vòng hẹn giờ một lượt: bắn mọi hẹn tới hạn của công ty (như `fireDueTimers`, từng hàng). */
async function fireDue(): Promise<number> {
  const due = await o<
    { id: string; run: string; stage: string }[]
  >`select id, process_run_id as run,
      stage_run_id as stage from hub.process_timers
    where tenant_id = ${T} and fired_at is null and cancelled_at is null and due_at <= now() order by due_at`;
  let n = 0;
  for (const t of due) {
    const r = await uow().system(T, (repos) =>
      fireTimer(repos, { id: t.id, runId: t.run, stageRunId: t.stage }, new Date()),
    );
    if (r === "fired") n++;
  }
  return n;
}
const childrenOf = (runId: string) =>
  o<
    { id: string; status: string }[]
  >`select id, status from hub.process_runs where parent_run_id = ${runId}`;
const runOf = async (runId: string) =>
  (await o<{ status: string }[]>`select status from hub.process_runs where id = ${runId}`)[0]
    ?.status;
const stagesOf = async (runId: string) =>
  (
    await o<{ status: string }[]>`select status from hub.stage_runs where process_run_id = ${runId}
      order by stage_idx`
  ).map((r) => r.status);
const phaseFields = async (runId: string) =>
  (
    await o<{ fields: Record<string, unknown> }[]>`select o.fields from hub.stage_runs s
      join hub.process_outputs o on o.id = s.current_output_id
      where s.process_run_id = ${runId} and s.stage_idx = 0`
  )[0]?.fields;

const openTimers = async (runId: string) =>
  Number(
    (
      await o<{ n: number }[]>`select count(*)::int as n from hub.process_timers
        where process_run_id = ${runId} and fired_at is null and cancelled_at is null`
    )[0]?.n,
  );
/** «Dừng» lượt cha như `GateService.cancel` (tx scope user, khoá cha → `cancelEnd`). */
const cancelParent = (pid: string, lockTimeout?: string) =>
  withHubScope(db, { kind: "user", tenantId: T, userId: A }, async (tx) => {
    if (lockTimeout) await tx.execute(sql.raw(`set local lock_timeout = '${lockTimeout}'`));
    const run = await core.lockRun(tx, T, pid);
    if (!run) throw new Error("no run");
    await cancelEnd({ d, tx }, { run, idx: 0, ref: await actorRef(tx, A, T) }, null);
  });

let okDef = "";
let noDef = "";
let waitDef = "";

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 6);
  await o`insert into admin.tenants (id, key, name) values (${T}, 't12501', 'T')`;
  [A] = (await users(o, T, 1, { from: 12_501 })) as [string];
  // Con «sp-ok»: 0 ghi amount (từ đầu vào) + vendor · 1 Kết thúc approved. Con «sp-no»: Kết thúc rejected. Con «sp-wait»: chờ 24 giờ.
  const setValues = {
    ...base("ghi", "Ghi", 0, ["amount", "vendor"]),
    executor: {
      kind: "set",
      values: [
        { key: "amount", from: { input: "amount" } },
        { key: "vendor", from: { const: "ACME" } },
      ],
    },
  };
  await def("sp-ok", [setValues, end("xong", 1, "approved")], AMOUNT);
  await def("sp-no", [end("tu-choi", 0, "rejected")], AMOUNT);
  await def(
    "sp-wait",
    [{ ...base("cho", "Chờ", 0), executor: { kind: "wait_for", hours: 24 } }],
    AMOUNT,
  );
  okDef = await def("p-ok", parentStages("sp-ok"), AMOUNT);
  noDef = await def("p-no", parentStages("sp-no"), AMOUNT);
  waitDef = await def("p-wait", parentStages("sp-wait"), AMOUNT);
  d = mkDeps();
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-125 · «Quy trình con» chạy thật", () => {
  it("mở MỘT lượt con ⇒ con xong ⇒ cha đi tiếp `done` với dữ liệu `sub_*`, lượt cha xong", async () => {
    const pid = await start(okDef);
    const kids = await childrenOf(pid);
    expect(kids.map((k) => k.status)).toEqual(["done"]);
    expect((await stagesOf(pid))[0]).toBe("waiting_timer");
    expect(await fireDue()).toBe(1);
    expect(await phaseFields(pid)).toMatchObject({
      outcome: "done",
      sub_amount: "1200",
      sub_vendor: "ACME",
    });
    expect(await stagesOf(pid)).toEqual(["done", "done", "skipped"]);
    expect(await runOf(pid)).toBe("done");
  });

  it("con kết thúc Từ chối ⇒ cha rẽ đầu ra `rejected` (bước 2)", async () => {
    const pid = await start(noDef);
    expect(await fireDue()).toBe(1);
    expect((await phaseFields(pid))?.outcome).toBe("rejected");
    expect(await stagesOf(pid)).toEqual(["done", "skipped", "done"]);
    expect(await runOf(pid)).toBe("done");
  });

  it("kick lại / stage về hàng đợi cùng lần chạy ⇒ không mở lượt con thứ hai", async () => {
    const pid = await start(waitDef);
    await d.launcher.kick(pid);
    await o`update hub.stage_runs set status = 'queued' where process_run_id = ${pid} and stage_idx = 0`;
    await Promise.all([d.launcher.kick(pid), d.launcher.kick(pid)]);
    const kids = await childrenOf(pid);
    expect(kids.length).toBe(1);
    expect(kids[0]?.status).toBe("waiting_timer");
    expect((await stagesOf(pid))[0]).toBe("waiting_timer");
  });

  it("huỷ lượt cha ⇒ lượt con còn chạy bị huỷ, không hẹn mở nào cho cha", async () => {
    const pid = await start(waitDef);
    const [kid] = await childrenOf(pid);
    await cancelParent(pid);
    expect(await runOf(pid)).toBe("cancelled");
    expect(await runOf(kid?.id as string)).toBe("cancelled");
    expect(await openTimers(kid?.id as string)).toBe(0);
    expect(await openTimers(pid)).toBe(0);
  });

  it("huỷ cha ĐỒNG THỜI lượt con kết thúc (hai thứ tự khoá) ⇒ không lỗi, không chờ khoá, trạng thái nhất quán", async () => {
    // (1) cha đang bị khoá (tx huỷ giữ hàng cha) ⇒ tx kết thúc lượt con KHÔNG chờ hàng cha (lock_timeout 2 s ⇒ lỗi nếu chờ).
    const p1 = await start(waitDef);
    const [k1] = await childrenOf(p1);
    await withHubScope(db, { kind: "user", tenantId: T, userId: A }, async (tx) => {
      const run = await core.lockRun(tx, T, p1);
      if (!run) throw new Error("no run");
      await o.begin(async (t) => {
        await t`set local lock_timeout = '2s'`;
        await t`update hub.process_runs set status = 'done', finished_at = now() where id = ${k1?.id as string}`;
      });
      await cancelEnd({ d, tx }, { run, idx: 0, ref: await actorRef(tx, A, T) }, null);
    });
    expect([await runOf(p1), await runOf(k1?.id as string)]).toEqual(["cancelled", "done"]);
    // (2) lượt con đang kết thúc (giữ hàng con) ⇒ huỷ cha chờ hàng con rồi đi tiếp sau khi con COMMIT.
    const p2 = await start(waitDef);
    const [k2] = await childrenOf(p2);
    let updated: () => void = () => {};
    let release: () => void = () => {};
    const isUpdated = new Promise<void>((r) => {
      updated = r;
    });
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const finishing = o.begin(async (t) => {
      await t`set local lock_timeout = '5s'`;
      await t`update hub.process_runs set status = 'done', finished_at = now() where id = ${k2?.id as string}`;
      updated();
      await gate;
    });
    await isUpdated;
    const cancelling = cancelParent(p2, "5s");
    release();
    await Promise.all([finishing, cancelling]);
    expect([await runOf(p2), await runOf(k2?.id as string)]).toEqual(["cancelled", "done"]);
    expect(await fireDue()).toBe(0);
    expect(await stagesOf(p2)).toEqual(["cancelled", "cancelled", "cancelled"]);
  });

  it("lượt cha hết hạn ⇒ lượt con còn chạy bị huỷ", async () => {
    const pid = await start(waitDef);
    const [kid] = await childrenOf(pid);
    await o`update hub.process_runs set expires_at = now() - interval '1 minute' where id = ${pid}`;
    expect(await expireRuns(d as unknown as ProcessBgDeps)).toBeGreaterThanOrEqual(1);
    expect([await runOf(pid), await runOf(kid?.id as string)]).toEqual(["expired", "cancelled"]);
  });

  it("lượt con không còn (bị xoá / gỡ liên kết) ⇒ hẹn canh chốt cha đầu ra `cancelled` + reason", async () => {
    const pid = await start(waitDef);
    const [kid] = await childrenOf(pid);
    await o`update hub.process_runs set parent_run_id = null, parent_stage_run_id = null, parent_attempt = null,
      parent_round = null where id = ${kid?.id as string}`;
    await o`update hub.process_timers set due_at = now() where process_run_id = ${pid} and fired_at is null`;
    expect(await fireDue()).toBe(1);
    expect(await phaseFields(pid)).toMatchObject({ outcome: "cancelled", reason: "child_missing" });
    expect(await stagesOf(pid)).toEqual(["done", "skipped", "done"]);
  });

  it("hẹn canh tới khi con còn chạy ⇒ ghi hẹn canh kế, con xong ⇒ chốt MỘT lần (hẹn thừa bị bỏ)", async () => {
    const pid = await start(waitDef);
    const [kid] = await childrenOf(pid);
    await o`update hub.process_timers set due_at = now() where process_run_id = ${pid} and fired_at is null`;
    expect(await fireDue()).toBe(1);
    expect((await stagesOf(pid))[0]).toBe("waiting_timer");
    expect(await openTimers(pid)).toBe(1);
    await o`update hub.process_runs set status = 'done', finished_at = now() where id = ${kid?.id as string}`;
    expect(await fireDue()).toBe(1);
    expect((await phaseFields(pid))?.outcome).toBe("done");
    expect(await fireDue()).toBe(0);
    const [n] = await o<{ n: number }[]>`select count(*)::int as n from hub.process_outputs
      where process_run_id = ${pid} and stage_idx = 0`;
    expect(n?.n).toBe(1);
  });

  it("lượt con lỗi ⇒ bước cha «Cần xử lý» (tool_failed)", async () => {
    const pid = await start(waitDef);
    const [kid] = await childrenOf(pid);
    await o`update hub.process_runs set status = 'failed', finished_at = now() where id = ${kid?.id as string}`;
    expect(await fireDue()).toBe(1); // bắn ⇒ stage về hàng đợi ⇒ launcher mở «Cần xử lý» (không ghi output)
    expect(await runOf(pid)).toBe("needs_decision");
    expect((await stagesOf(pid))[0]).toBe("needs_decision");
    const [r] = await o<
      { reason: string }[]
    >`select decision->>'reason' as reason from hub.process_runs where id = ${pid}`;
    expect(r?.reason).toBe("tool_failed");
  });
});

describe("CR-125 · «Quy trình con» guard khi lưu", () => {
  const input = (key: string, defKey: string) =>
    ({
      key,
      stages: [{ executor: { kind: "subprocess", def_key: defKey } }],
    }) as unknown as ProcessDefInput;
  const check = async (i: ProcessDefInput) => {
    try {
      await withHubScope(db, { kind: "system" }, (tx) => subprocessCheck(tx, T, i));
      return "ok";
    } catch (e) {
      return e instanceof AppError ? e.code : String(e);
    }
  };

  it("quy trình không có ⇒ SUBPROCESS_NOT_FOUND, có ⇒ ok", async () => {
    expect(await check(input("g-x", "khong-co"))).toBe("SUBPROCESS_NOT_FOUND");
    expect(await check(input("g-x", "sp-ok"))).toBe("ok");
  });

  it("gọi vòng A → B → A ⇒ SUBPROCESS_CYCLE (kể cả tự gọi chính mình)", async () => {
    await def("g-a", [{ executor: { kind: "subprocess", def_key: "g-b" } }]);
    expect(await check(input("g-b", "g-a"))).toBe("SUBPROCESS_CYCLE");
    expect(await check(input("g-self", "g-self"))).toBe("SUBPROCESS_CYCLE");
  });

  it("lồng quá 3 tầng ⇒ SUBPROCESS_DEPTH, đúng 3 ⇒ ok", async () => {
    await def("g-d2", [{ executor: { kind: "subprocess", def_key: "g-d3" } }]);
    await def("g-d3", [{ executor: { kind: "subprocess", def_key: "g-d4" } }]);
    await def("g-d4", [{ executor: { kind: "subprocess", def_key: "g-d5" } }]);
    await def("g-d5", [{ executor: { kind: "set" } }]);
    expect(await check(input("g-d1", "g-d2"))).toBe("SUBPROCESS_DEPTH");
    expect(await check(input("g-d1", "g-d3"))).toBe("ok");
  });
});
