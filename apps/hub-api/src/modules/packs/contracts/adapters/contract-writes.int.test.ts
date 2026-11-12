// CR-127 K1b · BR-02/77/78 · spec §3: các đường GHI trạng thái HĐ đi qua cổng `applyTransition` / `initialState` (DB thật, role gói
// `contracts_rw` + RLS): upload (draft + extract_state reading), extraction (extracted / extract_failed), nhập tay + giao dịch ⇒ done
// (+ effect), outcome flow (approved / rejected / returned), HĐ nhận (partner_received ⇒ processing), và KHÔNG còn UPDATE status ngoài
// cổng (trigger `contracts_status_gate` bắt).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb } from "@ai/db";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { sql } from "drizzle-orm";
import { connectDb, type Db } from "../../../../lib/db";
import { createPackUow } from "../../kit/adapters/pack-uow";
import { withSystemScope } from "../../kit/testing/system-scope";
import { cksWriteRepo } from "../cks/adapters/cks-write.repo";
import { approvalRepo } from "./approval.repo";
import { sweepRepo } from "./approval-sweep.repo";
import { applyContractOutcome } from "./contract-flow.repo";
import { contractStateRepo } from "./contract-state.repo";
import { extractionRepo } from "./extraction.repo";
import { applyReceivedOutcome } from "./partner-inbox.repo";
import { reviewRepo } from "./review.repo";
import { uploadContractRepo } from "./upload-contract.repo";

let o: Sql;
let db: Db;
const hub = createDb(urls().hubApi, { max: 3 });
let T = "";
let U = "";

const uow = () =>
  createPackUow(db, "contracts", (tx, tid) => ({
    up: uploadContractRepo(tx, tid),
    ex: extractionRepo(tx, tid),
    ap: approvalRepo(tx, tid),
    tx,
  }));
const who = () => ({ tenantId: T, userId: U });

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  [T] = (await tenants(o, 1, 9128)) as [string];
  [U] = (await users(o, T, 1, { from: 9128 })) as [string];
});
afterAll(async () => {
  await db?.close();
  await hub.close();
  await o?.end({ timeout: 2 });
});

const uploadRow = (id: string, extractState: "reading" | "failed" | "ready") => ({
  id,
  fileRowId: crypto.randomUUID(),
  org: `t_${T}`,
  fileId: "f1",
  versionId: "v1",
  name: "a.pdf",
  mime: "application/pdf",
  size: 10,
  kind: "contract" as const,
  parentId: null,
  title: "HĐ K1b",
  extractState,
  error: null,
  fields: {},
  sourceText: "text",
  userId: U,
  approvalId: extractState === "reading" ? crypto.randomUUID() : null,
});

describe("K1b · đường ghi trạng thái qua cổng", () => {
  it("upload ⇒ draft + reading; extraction ⇒ extracted (ready) / extract_failed qua cổng", async () => {
    const id = crypto.randomUUID();
    const id2 = crypto.randomUUID();
    const out = await uow().tenant(who(), async (r) => {
      const a = await r.up.insert(uploadRow(id, "reading") as never);
      const b = await r.up.insert(uploadRow(id2, "reading") as never);
      const okFail = await r.ex.saveFailure(id2, "AGENT_FAIL");
      const failAgain = await r.ex.saveFailure(id2, "AGAIN"); // không còn reading ⇒ false
      const src = await r.ex.source(id);
      const again = await r.ex.requestExtract(id, U); // đang reading ⇒ busy
      const saved = await r.ex.saveResult(id, {
        fields: {},
        items: [],
        clauses: [],
        warnings: [],
        ai: null,
        expected: src?.version ?? 0,
      } as never);
      const after = await r.ex.source(id);
      const req = await r.ex.requestExtract(id2, U); // failed ⇒ reading lại
      return { a, b, okFail, failAgain, again, saved, after, req };
    });
    expect(out.a).toMatchObject({ status: "draft", extractState: "reading" });
    expect(out.okFail).toBe(true);
    expect(out.failAgain).toBe(false);
    expect(out.again).toEqual({ kind: "busy" });
    expect(out.saved).toBe(true);
    expect(out.after).toMatchObject({ status: "draft", extractState: "ready" });
    expect(out.req.kind).toBe("ok");
    const [ev] = await o<{ n: string }[]>`select count(*)::text as n from contracts.contract_events
      where contract_id = ${id} and type = 'status_changed' and data->>'ev' = 'extracted'`;
    expect(ev?.n).toBe("1");
  });

  it("nhập tay / giao dịch ⇒ DONE ngay + effect + mốc mặc định (created_done)", async () => {
    const m = (id: string, deal: boolean) => ({
      id,
      title: "Tay",
      direction: "sale" as const,
      deal: "sell",
      commissionPct: null,
      commissionFixed: null,
      milestones: [],
      fields: {},
      items: [],
      warnings: [],
      userId: U,
      ...(deal ? { deal_doc: { source: "verbal" as const } } : {}),
    });
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    const rows = await uow().tenant(who(), async (r) => [
      await r.ex.insertManual(m(a, false) as never),
      await r.ex.insertManual(m(b, true) as never),
    ]);
    expect(rows.map((x) => x.status)).toEqual(["done", "done"]);
    const got = await o<
      { status: string; effect: string | null; locked: boolean }[]
    >`select status, effect,
      locked_at is not null as locked from contracts.contracts where id in (${a}, ${b}) order by created_at`;
    expect(got.every((x) => x.status === "done" && x.effect !== null)).toBe(true);
  });

  it("outcome flow: approved ⇒ done; rejected ⇒ reject; returned ⇒ draft; chạy lại ⇒ already_applied/not_found", async () => {
    const mk = async (): Promise<{ cid: string; aid: string }> => {
      const cid = crypto.randomUUID();
      const aid = crypto.randomUUID();
      await o`insert into contracts.contracts (id, tenant_id, title, created_by, status, run_id)
        values (${cid}, ${T}, 'Flow', ${U}, 'processing', ${aid})`;
      await o`insert into contracts.approvals (id, tenant_id, contract_id, status, started_by, mode)
        values (${aid}, ${T}, ${cid}, 'level1', ${U}, 'engine')`;
      return { cid, aid };
    };
    const run = (cid: string, outcome: "approved" | "rejected" | "returned") =>
      withSystemScope(hub, { kind: "system" }, (tx) =>
        applyContractOutcome(
          tx,
          {
            tenantId: T,
            ref: cid,
            runId: crypto.randomUUID(),
            actorId: U,
            event: "contract.submitted",
            outcome,
          } as never,
          outcome,
        ),
      );
    const res: Record<string, string> = {};
    for (const oc of ["approved", "rejected", "returned"] as const) {
      const { cid } = await mk();
      res[oc] = await run(cid, oc).catch((e) => `ERR ${String(e).slice(0, 80)}`);
      const [c] = await o<
        { status: string; run_id: string | null }[]
      >`select status, run_id from contracts.contracts where id = ${cid}`;
      res[`${oc}_st`] = `${c?.status}/${c?.run_id === null ? "norun" : "run"}`;
    }
    expect(res.approved_st).toBe("done/run");
    expect(res.rejected_st).toBe("reject/run");
    expect(res.returned_st).toBe("draft/norun");
  });

  it("ghi thẳng status ngoài cổng bị trigger chặn (STATUS_GATE_ONLY)", async () => {
    const id = crypto.randomUUID();
    await o`insert into contracts.contracts (id, tenant_id, title, created_by, status) values (${id}, ${T}, 'x', ${U}, 'draft')`;
    let msg = "";
    try {
      await o`update contracts.contracts set status = 'processing' where id = ${id}`;
    } catch (e) {
      msg = String(e);
    }
    expect(msg).toContain("STATUS_GATE_ONLY");
  });
});

// ---- K1b soát Opus: máy cũ qua cổng, CAS run_id, sweep bulk, HĐ nhận, loseRenewal, version +1, chặn chéo tenant ----
describe("K1b · máy cũ / outcome / chéo tenant", () => {
  let TB = "";
  let UB = "";
  const uowB = () => createPackUow(db, "contracts", (tx) => ({ tx }));
  const mkC = async (status: string, aid: string | null = null) => {
    const id = crypto.randomUUID();
    await o`insert into contracts.contracts (id, tenant_id, title, created_by, status, run_id)
      values (${id}, ${T}, 'K1b', ${U}, ${status}, ${aid})`;
    if (aid)
      await o`insert into contracts.approvals (id, tenant_id, contract_id, status, started_by, mode)
        values (${aid}, ${T}, ${id}, 'level1', ${U}, 'engine')`;
    return id;
  };
  const stOf = async (id: string) =>
    (
      await o<
        { status: string; version: number }[]
      >`select status, version from contracts.contracts where id = ${id}`
    )[0];

  beforeAll(async () => {
    [TB] = (await tenants(o, 1, 9129)) as [string];
    [UB] = (await users(o, TB, 1, { from: 9129 })) as [string];
  });

  it("outcome chạy lại ⇒ already_applied; sweep reconcile dùng GUC bulk rồi hạ cờ", async () => {
    const cid = await mkC("processing", crypto.randomUUID());
    const input = {
      tenantId: T,
      ref: cid,
      runId: crypto.randomUUID(),
      actorId: U,
      event: "contract.submitted",
      outcome: "approved",
    } as never;
    const run = () =>
      withSystemScope(hub, { kind: "system" }, (tx) => applyContractOutcome(tx, input, "approved"));
    expect([await run(), await run()]).toEqual(["applied", "already_applied"]);

    const aid2 = crypto.randomUUID();
    const c2 = await mkC("processing", aid2);
    const run2 = crypto.randomUUID();
    await o`update contracts.approvals set engine_run_id = ${run2} where id = ${aid2}`;
    let afterReset = "";
    const n = await uowB().tenant(who(), async (r) => {
      const res = await sweepRepo(r.tx as never, T).reconcile([
        { approvalId: aid2, runId: run2, kind: "reject", feedback: "x" },
      ]);
      const [g] = await r.tx.execute<{ g: string }>(
        sql`select coalesce(current_setting('contracts.state_gate', true), '') as g`,
      );
      afterReset = g?.g ?? "x";
      return res;
    });
    expect(n.rejected).toBe(1);
    expect(afterReset).toBe(""); // cờ bulk đã hạ ngay sau câu UPDATE theo tập
    expect((await stOf(c2))?.status).toBe("reject");
  });

  it("applyReceivedOutcome: HĐ nhận không ở processing ⇒ ném (chưa trả lời đối tác)", async () => {
    const bad = await mkC("draft");
    await o`insert into contracts.partner_inbox (tenant_id, contract_id, mailbox_id, sender_name, expires_at)
      values (${T}, ${bad}, ${crypto.randomUUID()}, 'A', now() + interval '1 day')`;
    const inp = {
      tenantId: T,
      ref: bad,
      runId: crypto.randomUUID(),
      actorId: U,
      event: "contract.received",
      outcome: "declined",
    } as never;
    const err = await withSystemScope(hub, { kind: "system" }, (tx) =>
      applyReceivedOutcome(tx, inp),
    ).then(
      () => "",
      (e) => String(e),
    );
    expect(err).toContain("không ở processing");
    expect((await stOf(bad))?.status).toBe("draft");
  });

  it("loseRenewal: HĐ gia hạn vẫn done, effect_outcome terminated, effect tính lại", async () => {
    const sale = await mkC("done");
    const nc = await mkC("done");
    const cu = crypto.randomUUID();
    const rid = crypto.randomUUID();
    await o`insert into contracts.cks_customers (id, tenant_id, name) values (${cu}, ${T}, 'KH')`;
    await o`insert into contracts.cks_renewals (id, tenant_id, sale_contract_id, customer_id, certificate_ids, new_contract_id, price_each, valid_to, created_by)
      values (${rid}, ${T}, ${sale}, ${cu}, array[${crypto.randomUUID()}::uuid], ${nc}, 1, '2030-01-01', ${U})`;
    await uowB().tenant(who(), (r) =>
      cksWriteRepo(r.tx as never, T).loseRenewal({
        id: rid,
        reason: "mất",
        today: "2026-11-10",
        audit: [],
      } as never),
    );
    const [c] = await o<
      { status: string; effect: string | null; oc: string | null }[]
    >`select status, effect, effect_outcome as oc from contracts.contracts where id = ${nc}`;
    expect(c).toMatchObject({ status: "done", effect: "terminated", oc: "terminated" });
  });

  it("version +1: review.save + activate; không còn draft ⇒ not_draft", async () => {
    const plan = (activate: boolean) => ({
      fields: {},
      deal: "sell",
      direction: "sale",
      commissionPct: null,
      commissionFixed: null,
      activate,
      changes: [],
      milestones: null,
    });
    const id = await mkC("draft");
    const v0 = (await stOf(id))?.version ?? 0;
    const saved = await uowB().tenant(who(), (r) =>
      reviewRepo(r.tx as never, T).save(id, {
        plan: plan(true),
        items: null,
        expected: v0,
        actor: U,
      } as never),
    );
    expect(typeof saved === "object" && saved.version).toBe(v0 + 1);
    expect(await stOf(id)).toMatchObject({ status: "done", version: v0 + 1 });
    const id2 = await mkC("done");
    const none = await uowB().tenant(who(), (r) =>
      reviewRepo(r.tx as never, T).save(id2, {
        plan: plan(false),
        items: null,
        expected: 1,
        actor: U,
      } as never),
    );
    expect(none).toBe("not_draft");
  });

  it("chặn chéo tenant: tenant B gọi cổng lên HĐ của A ⇒ STATE_CONFLICT, HĐ A nguyên", async () => {
    const id = await mkC("processing");
    const before = await stOf(id);
    const res = await uowB().tenant({ tenantId: TB, userId: UB }, (r) =>
      contractStateRepo(r.tx as never, TB).applyTransition({
        contractId: id,
        ev: "flow_approved",
        actorId: UB,
      }),
    );
    expect(res).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(await stOf(id)).toEqual(before);
  });
});
