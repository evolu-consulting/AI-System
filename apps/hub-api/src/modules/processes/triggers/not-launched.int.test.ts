// CR-122 · P11b · lượt duyệt HĐ chờ flow mà KHÔNG mở được run thì không kẹt mãi: (1) 0 flow khớp ⇒ thẻ ghi lý do FLOW_NOT_ASSIGNED (web:
// "chưa có quy trình … gán ở Công ty › Quy trình, rồi bấm Mở lại"); gán flow + Mở lại (phát lại sự kiện, event_id mới) ⇒ lượt chạy đúng;
// (2) flow cần nhóm công ty chưa có ⇒ lý do FLOW_GROUP_MISSING:<mã>. Đường thật: dispatchOnce + flowLaunchOf + launcher thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withHubScope } from "@ai/db/hub-scope";
import { contracts, tenantId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../lib/db";
import { approvalRepo } from "../../packs/contracts/adapters/approval.repo";
import { contractFlowRepo } from "../../packs/contracts/adapters/contract-flow.repo";
import {
  actApproval,
  getApproval,
  startApproval,
} from "../../packs/contracts/application/approval.usecase";
import { withFlowResend } from "../../packs/contracts/application/flow-resend.usecase";
import { contractsOutcomeHandler } from "../../packs/contracts/flow-events.mount";
import { createPackUow } from "../../packs/kit/adapters/pack-uow";
import { registerOutcomeHandler, unregisterFlowPorts } from "../adapters/runs/flow-ports";
import type { ProcessDeps } from "../core/ports";
import { createStageLauncher } from "../runs/launcher";
import { dispatchOnce } from "./dispatcher";
import { setFlowTriggers } from "./flags";
import { flowLaunchOf } from "./flow-launch";

const N = tenantId(1301); // chưa gán flow
const G = tenantId(1302); // flow cần nhóm chưa có
let UN = "";
let UG = "";
let CN = "";
let CG = "";
let lib = "";
let CX: string[] = []; // P11c · HĐ của N (flow đã gán sau ca đầu)
let o: Sql;
let db: Db;

const stage = (groupKey: string) => ({
  key: "duyet",
  name: "Duyệt pháp chế",
  step: 0,
  instruction: "",
  output: { filename: "d.md", template: "x", required_sections: ["x"], fields: [] },
  real_action: false,
  answerer: { kind: "starter" },
  token_budget: null,
  executor: { kind: "approve", reject_step: null, return_step: null },
  after: {
    kind: "review",
    group_id: null,
    group_key: groupKey,
    back_to_steps: [],
    remind_every_h: null,
    escalate: null,
    branch: [],
    exclude_starter: false,
  },
});

async function libFlow(key: string, groupKey: string): Promise<string> {
  const st = JSON.stringify([stage(groupKey)]);
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, trigger,
      app, published_version, enabled) values (null, ${key}, 'Duyệt HĐ', ${st}::text::jsonb,
      '{"event":"contract.submitted"}'::jsonb, 'contracts', 1, true) returning id::text as id`;
  const id = r?.id as string;
  await o`insert into hub.process_def_releases (def_id, rel_version, name, stages) values (${id}, 1, 'Duyệt HĐ', ${st}::text::jsonb)`;
  return id;
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 6);
  await o`insert into admin.tenants (id, key, name) values (${N}, 't1301', 'N'), (${G}, 't1302', 'G')`;
  [UN] = (await users(o, N, 1, { from: 1301 })) as [string];
  [UG] = (await users(o, G, 1, { from: 1302 })) as [string];
  CN = (
    await contracts(o, N, 1, { from: 1301, createdBy: UN, status: "needs_review" })
  )[0] as string;
  CG = (
    await contracts(o, G, 1, { from: 1302, createdBy: UG, status: "needs_review" })
  )[0] as string;
  CX = await contracts(o, N, 6, { from: 1310, createdBy: UN, status: "needs_review" });
  await o`insert into admin.groups (tenant_id, key, name) values (${N}, 'pb-phap-che', '{"vi":"Pháp chế"}'::jsonb)`;
  lib = await libFlow("p11b-ok", "pb-phap-che");
  const missing = await libFlow("p11b-miss", "pb-khong-co");
  await o`insert into hub.company_flows (tenant_id, flow_id, enabled) values (${G}, ${missing}, true)`;
  await withHubScope(db, { kind: "system" }, async (tx) => {
    await setFlowTriggers(tx, N, true);
    await setFlowTriggers(tx, G, true);
  });
  registerOutcomeHandler(contractsOutcomeHandler());
}, 120_000);
afterAll(async () => {
  unregisterFlowPorts("contracts");
  await db?.close();
  await o?.end({ timeout: 2 });
});

const pipe: unknown = new Proxy(
  {},
  { get: (_, k) => (k === "exec" ? async () => [] : () => pipe) },
);
function deps(): ProcessDeps {
  const d = {
    db,
    config: {
      user: async () => ({ active: true, groupIds: new Set<string>() }),
      poll: async () => {},
      catalog: async () => ({ features: [], entitled: new Set(), grantGroups: new Map() }),
    },
    redis: { pipeline: () => pipe },
    notifier: new Proxy({}, { get: () => async () => [] }),
    log: { warn: () => {}, info: () => {}, error: () => {} },
    now: () => new Date(),
    runsPerTenant: 100,
    postThread: async () => {},
  } as unknown as ProcessDeps & { launcher: unknown };
  d.launcher = createStageLauncher(d as never);
  return d;
}
const uow = () =>
  createPackUow(db, "contracts", (tx, tid) => ({
    approval: approvalRepo(tx, tid),
    contractFlow: contractFlowRepo(tx, tid),
  }));
const gateOn = { prepare: async () => ({ on: true, departments: null }) };
const ad = () =>
  ({
    uow: uow(),
    flow: gateOn,
    jobs: { enqueue: async () => {} },
    groups: {
      idsOf: async () => new Map(),
      userGroups: async () => new Set(),
      actionsOf: async () => new Set(["read", "write", "admin"]),
    },
  }) as never;
/** P11d · gửi duyệt như người dùng: mở lượt `level1` (nháp chờ rà soát) rồi "Xác nhận và lưu" ⇒ `contract.submitted`. */
async function submitHd(w: { tenantId: string; userId: string }, id: string, _initial: "level1") {
  const s = await startApproval(ad())(w, id, "level1");
  if (s !== "ok") return s;
  const out = await actApproval(ad())(w, id, { action: "approve" });
  return out && typeof out === "object" && "error" in out ? out.error : "ok";
}
const dispatch = () =>
  dispatchOnce({ db, launch: flowLaunchOf(deps()), now: () => new Date(Date.now() + 1000) });
const approvalOf = async (cid: string) =>
  (
    await o<{ run: string | null; feedback: string | null; status: string }[]>`
      select a.engine_run_id::text as run, a.feedback, a.status from contracts.approvals a
      join contracts.contracts c on c.run_id = a.id where c.id = ${cid}`
  )[0];

describe("CR-122 P11b · lượt chờ flow không mở được run", () => {
  it("0 flow khớp ⇒ lý do FLOW_NOT_ASSIGNED, gán flow + Mở lại (event_id mới) ⇒ run gắn vào lượt", async () => {
    const who = { tenantId: N, userId: UN };
    expect(await submitHd(who, CN, "level1")).toBe("ok");
    expect(await dispatch()).toMatchObject({ claimed: 1, launched: 0 });
    expect(await approvalOf(CN)).toMatchObject({
      run: null,
      feedback: "FLOW_NOT_ASSIGNED",
      status: "level1",
    });
    await o`insert into hub.company_flows (tenant_id, flow_id, enabled) values (${N}, ${lib}, true)`;
    const resend = withFlowResend(undefined, { uow: uow() as never, flow: gateOn });
    expect(await resend(who, CN)).toBe("ok");
    expect((await approvalOf(CN))?.feedback).toBe("FLOW_STARTING");
    expect(await dispatch()).toMatchObject({ claimed: 1, launched: 1, failed: 0 });
    const a = await approvalOf(CN);
    expect(a).toMatchObject({ feedback: null, status: "level1" });
    expect(a?.run).not.toBeNull();
    const [ev] = await o<{ n: number }[]>`select count(*)::int as n from hub.flow_events
      where tenant_id = ${N} and event = 'contract.submitted' and ref = ${CN}`;
    expect(ev?.n).toBe(2); // sự kiện gốc + sự kiện gửi lại (không bị coi là trùng)
  });

  it("flow cần nhóm công ty chưa có ⇒ lý do FLOW_GROUP_MISSING:<mã>", async () => {
    expect(await submitHd({ tenantId: G, userId: UG }, CG, "level1")).toBe("ok");
    expect(await dispatch()).toMatchObject({ claimed: 1, launched: 0 });
    expect(await approvalOf(CG)).toMatchObject({
      run: null,
      feedback: "FLOW_GROUP_MISSING:pb-khong-co",
      status: "level1",
    });
  });
});

const runsOf = async (cid: string) =>
  (
    await o<{ n: number }[]>`select count(*)::int as n from hub.process_runs
      where pack_key = 'contracts' and pack_record_id = ${cid}`
  )[0]?.n ?? 0;
/** Lượt đã kẹt thật (lý do khác FLOW_STARTING) — như sau khi bộ điều phối báo không mở được. */
const stuck = (cid: string) =>
  o`update contracts.approvals a set feedback = 'FLOW_START_FAILED' from contracts.contracts c
    where c.id = ${cid} and a.id = c.run_id`;

describe("CR-122 P11c · Mở lại an toàn + hook không chặn lô", () => {
  const who = () => ({ tenantId: N, userId: UN });
  const resend = () => withFlowResend(undefined, { uow: uow() as never, flow: gateOn });

  it("Mở lại 2 lần song song ⇒ một 'ok' + một 409 (flow_starting), đúng 1 run", async () => {
    const id = CX[0] as string;
    expect(await submitHd(who(), id, "level1")).toBe("ok");
    await o`update hub.flow_events set processed_at = now() where ref = ${id}`; // sự kiện đầu đã chốt (không mở được)
    await stuck(id);
    const outs = await Promise.all([resend()(who(), id), resend()(who(), id)]);
    expect([...outs].sort()).toEqual(["flow_starting", "ok"]);
    await dispatch();
    expect(await runsOf(id)).toBe(1);
  });

  it("Mở lại khi sự kiện đầu chưa xử lý xong ⇒ 409 (flow_starting), không phát thêm sự kiện", async () => {
    const id = CX[1] as string;
    expect(await submitHd(who(), id, "level1")).toBe("ok");
    expect(await resend()(who(), id)).toBe("flow_starting");
    const [ev] = await o<
      { n: number }[]
    >`select count(*)::int as n from hub.flow_events where ref = ${id}`;
    expect(ev?.n).toBe(1);
    await dispatch();
    expect(await runsOf(id)).toBe(1);
  });

  it("lượt đã có run + sự kiện thứ hai tới ⇒ superseded: tx tạo run rollback, vẫn 1 run, sự kiện chốt không lỗi", async () => {
    const id = CX[0] as string;
    const [a] = await o<
      { id: string }[]
    >`select run_id::text as id from contracts.contracts where id = ${id}`;
    await uow().tenant(who(), (r) =>
      r.contractFlow.emitContract("contract.submitted", id, `${a?.id}.extra`, {
        actor: UN,
        departments: null,
      }),
    );
    expect(await dispatch()).toMatchObject({ claimed: 1, launched: 0, failed: 0 });
    expect(await runsOf(id)).toBe(1);
    const [ev] = await o<{ outcome: { superseded?: string[] }; done: boolean }[]>`select outcome,
      processed_at is not null as done from hub.flow_events where event_id like ${`%${a?.id}.extra`}`;
    expect(ev?.done).toBe(true);
    expect(ev?.outcome.superseded).toHaveLength(1);
  });

  it("hook notLaunched ném ở một sự kiện ⇒ chỉ log, lô vẫn chốt các sự kiện khác", async () => {
    const [bad, good] = [CX[2] as string, CX[3] as string];
    await o`update hub.company_flows set enabled = false where tenant_id = ${N}`; // 0 flow khớp ⇒ cả hai cần báo
    const base = contractsOutcomeHandler();
    registerOutcomeHandler({
      ...base,
      notLaunched: async (tx, i) => {
        if (i.ref === bad) throw new Error("boom");
        return (base.notLaunched as NonNullable<typeof base.notLaunched>)(tx, i);
      },
    });
    try {
      expect(await submitHd(who(), bad, "level1")).toBe("ok");
      expect(await submitHd(who(), good, "level1")).toBe("ok");
      expect(await dispatch()).toMatchObject({ claimed: 2 });
      const done = await o<{ n: number }[]>`select count(*)::int as n from hub.flow_events
        where ref = any(${o.array([bad, good])}::text[]) and processed_at is not null`;
      expect(done[0]?.n).toBe(2);
      expect((await approvalOf(good))?.feedback).toBe("FLOW_NOT_ASSIGNED");
      expect((await approvalOf(bad))?.feedback).toBe("FLOW_STARTING");
    } finally {
      registerOutcomeHandler(base);
      await o`update hub.company_flows set enabled = true where tenant_id = ${N}`;
    }
  });

  it("p13 · đếm trong DB int: bài pending + mod_screen null có sẵn (ghi số vào tasks.md trước deploy)", async () => {
    const [r] = await o<{ n: number }[]>`select count(*)::int as n from community.posts
      where moderation = 'pending' and mod_screen is null`;
    console.log(`P11c p13: community.posts pending + mod_screen null = ${r?.n}`);
    expect(r?.n).toBeGreaterThanOrEqual(0);
  });
});

describe("CR-122 p24 · Mở lại khi đã có run + sản phẩm lúc xác nhận", () => {
  const who = () => ({ tenantId: N, userId: UN });
  const resendWith = (stalled: boolean) =>
    withFlowResend(undefined, { uow: uow() as never, flow: gateOn, stalled: async () => stalled });

  it("p24 · Mở lại khi lượt đã có run kẹt: run còn chạy ⇒ not_stalled (run giữ nguyên); run kẹt ⇒ bỏ run cũ, mở lượt flow mới, không rơi sang máy cũ", async () => {
    const id = CX[4] as string;
    expect(await submitHd(who(), id, "level1")).toBe("ok");
    expect(await dispatch()).toMatchObject({ launched: 1 });
    const first = await approvalOf(id);
    expect(first?.run).not.toBeNull();
    // run còn chạy ⇒ không đụng
    expect(await resendWith(false)(who(), id)).toBe("not_stalled");
    expect((await approvalOf(id))?.run).toBe(first?.run as string);
    // run đã kết thúc bất thường ⇒ mở lại bằng flow (event_id mới)
    expect(await resendWith(true)(who(), id)).toBe("ok");
    expect(await approvalOf(id)).toMatchObject({ run: null, feedback: "FLOW_STARTING" });
    expect(await dispatch()).toMatchObject({ launched: 1, failed: 0 });
    const again = await approvalOf(id);
    expect(again?.feedback).toBeNull();
    expect(again?.run).not.toBeNull();
    expect(again?.run).not.toBe(first?.run as string);
  });

  it("p24 · cờ flow bật: thẻ nháp luôn mở hộp SP (finalizes_on_approve), xác nhận kèm SP ⇒ pending_links", async () => {
    const id = CX[5] as string;
    expect(await startApproval(ad())(who(), id, "level1")).toBe("ok");
    const card = await getApproval(ad())(who(), id);
    expect(card).toMatchObject({ can_act: true, finalizes_on_approve: true });
    const links = [{ item_id: crypto.randomUUID(), product_id: crypto.randomUUID() }];
    const out = await actApproval(ad())(who(), id, { action: "approve", products: links } as never);
    expect(out && typeof out === "object" && "error" in out).toBe(false);
    const [pl] = await o<
      { pending_links: unknown }[]
    >`select a.pending_links from contracts.approvals a
      join contracts.contracts c on c.run_id = a.id where c.id = ${id}`;
    const stored =
      typeof pl?.pending_links === "string" ? JSON.parse(pl.pending_links) : pl?.pending_links;
    expect(stored).toEqual(links);
  });
});
