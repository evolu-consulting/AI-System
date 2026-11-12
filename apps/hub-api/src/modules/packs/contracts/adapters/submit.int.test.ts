// CR-127 K3 · BR-02/03/04/36a · spec §3 (#3, #4, #8, #16): Gửi có/không quy trình (thẻ = lượt duyệt chờ flow + sự kiện `contract.submitted`),
// Rút về (3 lý do, Nhận việc không chặn, báo người giữ, hook lượt cũ bỏ qua), Gửi lại (từ đầu, hồ sơ giữ lượt cũ, UNCHANGED_REASON_REQUIRED),
// Tạo lại (chép tệp + văn bản + trường), FILE_REQUIRED. Cổng engine giả qua sổ kit (`registerFlowEngine`) — DB thật, role gói thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withHubScope } from "@ai/db/hub-scope";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../../lib/db";
import { type FlowRunStep, registerFlowEngine } from "../../kit/public";
import {
  recreateContract,
  submitContract,
  submitFlowOpen,
  submitPreview,
  withdrawContract,
} from "../application/submit.usecase";
import { packUow } from "../extraction.uow";
import { endFlowRun } from "./flow-end.repo";

let o: Sql;
let db: Db;
let T = "";
let U = "";
let U2 = "";
let hasFlow = false;
let step: FlowRunStep | null = null;
const cancels: { runId: string; notify: readonly string[] }[] = [];

const gate = { prepare: async () => ({ on: true, departments: [] as string[] }) };
const engine = () => ({
  availability: { hasFlowFor: async () => hasFlow },
  runControl: {
    inspect: async () => step,
    cancel: async (q: { runId: string; notify: readonly string[] }) => {
      cancels.push({ runId: q.runId, notify: q.notify });
      return true;
    },
  },
});
const deps = () => ({ uow: packUow(db), gate, engine });
const who = (u = U) => ({ tenantId: T, userId: u });

async function draft(extra: Record<string, unknown> = {}): Promise<string> {
  const id = crypto.randomUUID();
  await o`insert into contracts.contracts ${o({ id, tenant_id: T, title: "HĐ K3 gửi", created_by: U, status: "draft", extract_state: "ready", source_text: "Điều 1. Nội dung", ...extra } as never)}`;
  return id;
}
const row = async (id: string) =>
  (
    await o<{ status: string; submit_round: number; submitted_by: string | null }[]>`
      select status, submit_round, submitted_by from contracts.contracts where id = ${id}`
  )[0];

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  [T] = (await tenants(o, 1, 9427)) as [string];
  [U, U2] = (await users(o, T, 2, { from: 9427 })) as [string, string];
  registerFlowEngine(engine() as never);
}, 120_000);

afterAll(async () => {
  registerFlowEngine(null);
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-127 K3 Gửi", () => {
  it("NF1 · không có quy trình khớp ⇒ CHẶN NO_APPROVAL_FLOW, HĐ giữ DRAFT, không lượt/hồ sơ/sự kiện (#4); báo trước = cùng hàm", async () => {
    hasFlow = false;
    const id = await draft();
    expect(await submitFlowOpen(deps())(who(), id)).toBe(false);
    const out = await submitContract(deps())(who(), id, {});
    expect(out).toEqual({ error: "NO_APPROVAL_FLOW" });
    expect(await row(id)).toMatchObject({ status: "draft", submit_round: 0, submitted_by: null });
    const [n] = await o<{ s: number; e: number; a: number; f: number }[]>`select
      (select count(*)::int from contracts.contract_submissions where contract_id = ${id}) as s,
      (select count(*)::int from contracts.contract_events where contract_id = ${id}) as e,
      (select count(*)::int from contracts.approvals where contract_id = ${id}) as a,
      (select count(*)::int from hub.flow_events where tenant_id = ${T} and ref = ${id}) as f`;
    expect(n).toEqual({ s: 0, e: 0, a: 0, f: 0 });
    hasFlow = true;
    expect(await submitFlowOpen(deps())(who(), id)).toBe(true);
  });

  it("có quy trình ⇒ PROCESSING, thẻ = lượt chờ flow, sự kiện contract.submitted (#3); lần 2 ⇒ CONTRACT_NOT_DRAFT", async () => {
    hasFlow = true;
    const id = await draft();
    expect(await submitContract(deps())(who(), id, {})).toEqual({
      status: "processing",
      no_flow: false,
      round: 1,
    });
    const [a] = await o<{ mode: string; status: string; feedback: string; run: boolean }[]>`
      select x.mode, x.status, x.feedback, (c.run_id = x.id) as run from contracts.approvals x
      join contracts.contracts c on c.id = x.contract_id where x.contract_id = ${id}`;
    expect(a).toEqual({ mode: "engine", status: "level1", feedback: "FLOW_STARTING", run: true });
    const [ev] = await o<{ n: number }[]>`select count(*)::int as n from hub.flow_events
      where tenant_id = ${T} and ref = ${id} and event = 'contract.submitted'`;
    expect(ev?.n).toBe(1);
    expect(await submitContract(deps())(who(), id, {})).toEqual({ error: "CONTRACT_NOT_DRAFT" });
  });

  it("HĐ gia hạn chưa có tệp ⇒ FILE_REQUIRED; AI chưa đọc xong ⇒ EXTRACT_NOT_READY", async () => {
    const old = await draft();
    const id = await draft({ renews_id: old });
    expect(await submitContract(deps())(who(), id, {})).toEqual({ error: "FILE_REQUIRED" });
    const r = await draft({ extract_state: "reading" });
    expect(await submitContract(deps())(who(), r, {})).toEqual({ error: "EXTRACT_NOT_READY" });
  });
});

describe("CR-127 M4 xem trước các bước", () => {
  const OUT = {
    flowName: "Duyệt HĐ",
    steps: [{ kind: "review" as const, label: "KD duyệt", whoLabel: "Lê Hoa" }],
  };
  const withOutline = () => ({
    ...deps(),
    engine: () => ({
      ...engine(),
      availability: { hasFlowFor: async () => hasFlow, outline: async () => OUT },
    }),
  });

  it("có quy trình ⇒ trả bước (cùng hasFlowFor của Gửi); không đổi hàng nào (chỉ đọc)", async () => {
    hasFlow = true;
    const id = await draft();
    expect(await submitPreview(withOutline())(who(), id)).toEqual(OUT);
    expect(await row(id)).toMatchObject({ status: "draft", submit_round: 0 });
  });

  it("không quy trình ⇒ block no_flow (khớp NO_APPROVAL_FLOW của Gửi); người ngoài ⇒ forbidden; không thấy ⇒ not_found; không phải DRAFT ⇒ CONTRACT_NOT_DRAFT", async () => {
    const id = await draft();
    hasFlow = false;
    expect(await submitPreview(withOutline())(who(), id)).toEqual({
      block: "no_flow",
      flowName: null,
      steps: [],
    });
    expect(await submitContract(deps())(who(), id, {})).toEqual({ error: "NO_APPROVAL_FLOW" });
    hasFlow = true;
    expect(await submitPreview(withOutline())(who(U2), id)).toEqual({ error: "forbidden" });
    expect(await submitPreview(withOutline())(who(), crypto.randomUUID())).toEqual({
      error: "not_found",
    });
    await submitContract(deps())(who(), id, {});
    expect(await submitPreview(withOutline())(who(), id)).toEqual({ error: "CONTRACT_NOT_DRAFT" });
  });
});

describe("CR-127 K3 Rút về + Gửi lại", () => {
  it("3 lý do chặn; Nhận việc không chặn ⇒ draft + huỷ lượt + báo người giữ; hook lượt cũ bỏ qua; Gửi lại từ đầu", async () => {
    hasFlow = true;
    const id = await draft();
    await submitContract(deps())(who(), id, {});
    const run = crypto.randomUUID();
    await o`update contracts.approvals set engine_run_id = ${run}, feedback = null where contract_id = ${id}`;
    const w = withdrawContract(deps());
    expect(await w(who(U2), id, "nhầm")).toMatchObject({
      error: "WITHDRAW_NOT_ALLOWED",
      why: "not_submitter",
    });
    step = { open: true, decided: { by: U2, stageIdx: 0 }, claimers: [] };
    expect(await w(who(), id, "nhầm")).toMatchObject({
      error: "WITHDRAW_NOT_ALLOWED",
      why: "step_decided",
      by: U2,
    });
    step = { open: true, decided: null, claimers: [U2] };
    expect(await w(who(), id, "sửa giá")).toEqual({ status: "draft" });
    expect(cancels.at(-1)).toEqual({ runId: run, notify: [U2] });
    expect(await w(who(), id, "lần nữa")).toMatchObject({ why: "not_processing" });
    // Hook huỷ của lượt bị rút tới sau ⇒ CAS trượt, không ném, HĐ giữ draft.
    const late = await withHubScope(db, { kind: "system" }, (tx) =>
      endFlowRun(
        tx,
        { tenantId: T, ref: id, runId: run, reason: "cancelled:other" },
        "flow_cancelled",
      ),
    );
    expect(late).toBe(false);
    expect((await row(id))?.status).toBe("draft");
    // Gửi lại không đổi gì ⇒ cần lý do; có lý do ⇒ lượt MỚI, lượt cũ giữ (cancelled).
    expect(await submitContract(deps())(who(), id, {})).toEqual({
      error: "UNCHANGED_REASON_REQUIRED",
    });
    expect(
      await submitContract(deps())(who(), id, { unchangedReason: "đối tác đã đồng ý" }),
    ).toEqual({
      status: "processing",
      no_flow: false,
      round: 2,
    });
    const lots = await o<
      { status: string }[]
    >`select status from contracts.approvals where contract_id = ${id}
      order by created_at`;
    expect(lots.map((l) => l.status)).toEqual(["cancelled", "level1"]);
    const [s] = await o<
      { reason: string | null }[]
    >`select unchanged_reason as reason from contracts.contract_submissions
      where contract_id = ${id} and round = 2`;
    expect(s?.reason).toBe("đối tác đã đồng ý");
  });
});

/** HĐ về Nháp KHÔNG qua cổng đóng lượt (vd hub 0135 gỡ quy trình cũ) ⇒ lượt cũ còn sống. */
async function forceDraft(id: string) {
  await o.begin(async (tx) => {
    await tx`select set_config('contracts.state_gate', ${id}, true)`;
    await tx`update contracts.contracts set status = 'draft' where id = ${id}`;
  });
}
const submittedEvents = async (id: string) =>
  (
    await o<{ n: number }[]>`select count(*)::int as n from hub.flow_events
      where tenant_id = ${T} and ref = ${id} and event = 'contract.submitted'`
  )[0]?.n;

describe("CR-127 FIX-Z3 · mỗi lần Gửi một sự kiện mới (không kẹt processing)", () => {
  it("lượt cũ đã có run (bị huỷ) còn sống, HĐ về Nháp ⇒ Gửi lại không đổi: lượt MỚI + sự kiện MỚI, lượt cũ cancelled", async () => {
    hasFlow = true;
    const id = await draft();
    await submitContract(deps())(who(), id, {});
    const run = crypto.randomUUID();
    await o`update contracts.approvals set engine_run_id = ${run}, feedback = null where contract_id = ${id}`;
    await forceDraft(id);
    expect(
      await submitContract(deps())(who(), id, { unchangedReason: "gửi lại sau khi gỡ quy trình" }),
    ).toEqual({ status: "processing", no_flow: false, round: 2 });
    expect(await submittedEvents(id)).toBe(2);
    const lots = await o<{ status: string; run: string | null; cur: boolean }[]>`
      select x.status, x.engine_run_id::text as run, (c.run_id = x.id) as cur from contracts.approvals x
      join contracts.contracts c on c.id = x.contract_id where x.contract_id = ${id} order by x.created_at`;
    expect([...lots]).toEqual([
      { status: "cancelled", run, cur: false },
      { status: "level1", run: null, cur: true },
    ]);
  });

  it("lượt chờ flow (chưa run, đã phát sự kiện) còn sống, HĐ về Nháp ⇒ Gửi lại phát sự kiện MỚI", async () => {
    hasFlow = true;
    const id = await draft();
    await submitContract(deps())(who(), id, {});
    await forceDraft(id);
    await submitContract(deps())(who(), id, { unchangedReason: "thử lại" });
    expect(await submittedEvents(id)).toBe(2);
    // Bấm 2 lần: lần sau ⇒ CONTRACT_NOT_DRAFT, không thêm sự kiện.
    expect(await submitContract(deps())(who(), id, { unchangedReason: "thử lại" })).toEqual({
      error: "CONTRACT_NOT_DRAFT",
    });
    expect(await submittedEvents(id)).toBe(2);
  });

  it("HĐ processing mà run đã kết thúc (engine không còn bước) ⇒ Rút về được ⇒ Gửi lại phát sự kiện MỚI", async () => {
    hasFlow = true;
    const id = await draft();
    await submitContract(deps())(who(), id, {});
    await o`update contracts.approvals set engine_run_id = ${crypto.randomUUID()}, feedback = null where contract_id = ${id}`;
    step = null;
    expect(await withdrawContract(deps())(who(), id, "run đã huỷ")).toEqual({ status: "draft" });
    await submitContract(deps())(who(), id, { unchangedReason: "gửi lại" });
    expect((await row(id))?.status).toBe("processing");
    expect(await submittedEvents(id)).toBe(2);
  });
});

describe("CR-127 K3 Tạo lại (#16)", () => {
  it("HĐ gia hạn bị từ chối ⇒ tạo lại giữ liên kết gia hạn (renews_id)", async () => {
    const old = await draft();
    const id = await draft({ renews_id: old, file_id: null });
    await o.begin(async (tx) => {
      await tx`select set_config('contracts.state_gate', ${id}, true)`;
      await tx`update contracts.contracts set status = 'reject' where id = ${id}`;
    });
    const out = await recreateContract(deps())(who(), id);
    if (!("id" in out)) throw new Error(`recreate: ${JSON.stringify(out)}`);
    const [n] = await o<
      { renews_id: string | null }[]
    >`select renews_id from contracts.contracts where id = ${out.id}`;
    expect(n?.renews_id).toBe(old);
  });

  it("chỉ từ REJECT; HĐ mới DRAFT chép văn bản + trường", async () => {
    const id = await draft({ fields: { number: { value: "HĐ-9" } } });
    const rc = recreateContract(deps());
    expect(await rc(who(), id)).toEqual({ error: "CONTRACT_NOT_REJECTED" });
    await o.begin(async (tx) => {
      await tx`select set_config('contracts.state_gate', ${id}, true)`;
      await tx`update contracts.contracts set status = 'reject' where id = ${id}`;
    });
    const out = await rc(who(), id);
    if (!("id" in out)) throw new Error(`recreate: ${JSON.stringify(out)}`);
    const [n] = await o<
      { status: string; extract_state: string; source_text: string; num: string }[]
    >`
      select status, extract_state, source_text, fields->'number'->>'value' as num from contracts.contracts where id = ${out.id}`;
    expect(n).toEqual({
      status: "draft",
      extract_state: "ready",
      source_text: "Điều 1. Nội dung",
      num: "HĐ-9",
    });
  });
});
