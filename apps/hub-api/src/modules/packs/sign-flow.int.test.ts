// CR-181 · s9 · nối «ký trên tài liệu» vào lượt chạy (DB thật): cổng lượt ký (BR-D1, N2), kiểm Đạt (BR-D2/Q3), bước Ký ondoc
// (BR-D3/C4, Q6, Q8), Trả lại ⇒ void (Q17), chặn Gửi (BR-T2/C3), lưu `ondoc` (Q1), công ty TẮT ⇒ như cũ. Lượt engine dựng bằng SQL
// (`claim-seed`); người tạo HĐ = S, người được giao = A/B (khác người tạo).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../lib/db";
import { launchTimedWaitStage } from "../processes/runs/wait-timed-launch";
import { type ClaimWorld, claimWorld, groupTask } from "../processes/testing/claim-seed";
import { applyContractOutcome } from "./contracts/adapters/contract-flow.repo";
import { signOnBack, signWaitReady } from "./contracts/adapters/sign-flow.engine";
import { esignNodeApi } from "./contracts/application/esign-node.usecase";
import { signFlowHooks } from "./contracts/application/sign-flow.hooks";
import { withSystemScope } from "./kit/testing/system-scope";
import { type SignFlow, signFlowOf } from "./packs.sign-doc";

let o: Sql;
let db: Db;
let w: ClaimWorld;
let flow: SignFlow;
const fired: string[] = [];
const SHA = "a".repeat(64);
const PARTS = [{ page: 0, x: 40, y: 40, w: 120, h: 50, cx: 40, cy: 40, cw: 120, ch: 50 }];
const ESIGN = (signers: string) => ({
  key: "ky",
  name: "Ký",
  step: 1,
  after: { kind: "auto" },
  executor: {
    kind: "tool",
    tool_key: "contracts-esign-send",
    args: {
      provider: { from: "const", value: "ondoc" },
      company_signers: { from: "const", value: signers },
    },
  },
});
const WAIT = {
  key: "cho",
  name: "Chờ ký",
  step: 2,
  after: { kind: "auto" },
  executor: { kind: "wait_event", event: "esign.completed" },
};
const REVIEW = (g: string, evidence = "opinion_plus") => ({
  key: "duyet",
  name: "Duyệt",
  step: 0,
  after: { kind: "review", group_id: g, evidence },
});
type X = { id: string; fileId: string; runId: string };

async function setOnDoc(on: boolean) {
  await o`insert into hub.signature_settings (tenant_id, on_doc_enabled) values (${w.T}, ${on})
    on conflict (tenant_id) do update set on_doc_enabled = excluded.on_doc_enabled`;
}
/** HĐ của S + tệp cần ký + lượt engine gắn HĐ (bước `idx` của `stages`; task duyệt giao Group G). */
async function world(stages: unknown[], idx: number): Promise<X> {
  const { runId } = await groupTask(o, w, w.G);
  const [f] = await o<{ id: string }[]>`insert into contracts.files
      (tenant_id, org, file_id, name, mime, size_bytes, created_by)
    values (${w.T}, ${`t_${w.T}`}, ${`fb-${crypto.randomUUID()}`}, 'hd.pdf', 'application/pdf', 10, ${w.S})
    returning id::text as id`;
  const fileId = f?.id as string;
  const [c] = await o<
    { id: string }[]
  >`insert into contracts.contracts (tenant_id, title, created_by, status, file_id)
    values (${w.T}, 'HĐ s9', ${w.S}, 'processing', ${fileId}) returning id::text as id`;
  const id = c?.id as string;
  await o`insert into contracts.sign_docs (tenant_id, contract_id, file_id, needs_sign, pages, set_by)
    values (${w.T}, ${id}, ${fileId}, true, 1, ${w.S})`;
  await o`update hub.process_runs set pack_key = 'contracts', pack_record_id = ${id},
      snapshot = jsonb_set(snapshot, '{stages}', ${o.json(stages as never)}), current_stage_idx = ${idx},
      status = ${idx === 0 ? "waiting_review" : "waiting_timer"}
    where id = ${runId}`;
  return { id, fileId, runId };
}
async function field(x: X, side: "A" | "B", kind: string, ref: string): Promise<string> {
  const [r] = await o<{ id: string }[]>`insert into contracts.sign_fields
      (tenant_id, contract_id, file_id, side, signer_kind, signer_ref, parts, created_by)
    values (${w.T}, ${x.id}, ${x.fileId}, ${side}, ${kind}, ${ref}, ${o.json(PARTS as never)}, ${w.S}) returning id::text as id`;
  return r?.id as string;
}
async function version(x: X, by: string, seq = 1): Promise<string> {
  const [v] = await o<{ id: string }[]>`insert into contracts.sign_versions
      (tenant_id, contract_id, file_id, seq, out_file_id, sha256, signed_by, run_id)
    values (${w.T}, ${x.id}, ${x.fileId}, ${seq}, ${x.fileId}, ${SHA}, ${by}, ${x.runId}) returning id::text as id`;
  return v?.id as string;
}
const sign = async (fieldId: string, versionId: string, by: string) => {
  await o`update contracts.sign_fields set signed_version_id = ${versionId}, signed_by = ${by} where id = ${fieldId}`;
};
const engineDeps = {
  now: () => new Date(),
  log: { warn: () => {}, info: () => {}, error: () => {} },
  packWaitReady: (tx: never, e: Parameters<typeof signWaitReady>[1]) => signWaitReady(tx, e),
} as never;
const turnOf = (x: X, u: string) => flow.turn.turnFor({ tenantId: w.T, userId: u }, x.id, u);

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  w = await claimWorld(o, 9851);
  flow = signFlowOf(db);
  signFlowHooks.completed = async (_t, contractId) => void fired.push(contractId);
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-181 s9 · ký trên tài liệu theo lượt chạy", () => {
  it("D1 · người được giao khác người tạo có lượt, người ngoài nhóm bị từ chối", async () => {
    const x = await world([REVIEW(w.G)], 0);
    expect(await turnOf(x, w.A)).toEqual({ allowed: true, step: "approve", run_id: x.runId });
    expect((await turnOf(x, w.X)).allowed).toBe(false);
    expect((await turnOf(x, w.S)).allowed).toBe(false);
  });

  it("D2 · công ty bật, Đạt khi chưa ký thì thiếu tệp, ký đủ trong lượt thì không thiếu", async () => {
    await setOnDoc(true);
    const x = await world([REVIEW(w.G)], 0);
    const e = { tenantId: w.T, runId: x.runId, actor: w.A };
    expect(await signFlowHooks.beforePass?.(e)).toEqual({
      companyOn: true,
      onDoc: false,
      missing: [x.fileId],
    });
    await version(x, w.B); // người khác ký ⇒ A vẫn thiếu
    expect((await signFlowHooks.beforePass?.(e))?.missing).toEqual([x.fileId]);
    await version(x, w.A, 2);
    expect(await signFlowHooks.beforePass?.(e)).toEqual({
      companyOn: true,
      onDoc: true,
      missing: [],
    });
  });

  it("D2 · HĐ không có tệp cần ký thì không coi là đã ký, áp luật bằng chứng cũ", async () => {
    const x = await world([REVIEW(w.G)], 0);
    await o`update contracts.sign_docs set needs_sign = false where contract_id = ${x.id}`;
    const e = { tenantId: w.T, runId: x.runId, actor: w.A };
    expect(await signFlowHooks.beforePass?.(e)).toEqual({
      companyOn: true,
      onDoc: false,
      missing: [],
    });
  });

  it("công ty TẮT thì không áp, quyết định với chữ ký vẽ tay như cũ", async () => {
    await setOnDoc(false);
    const x = await world([REVIEW(w.G)], 0);
    const e = { tenantId: w.T, runId: x.runId, actor: w.A };
    expect(await signFlowHooks.beforePass?.(e)).toBeNull();
    await setOnDoc(true);
  });

  it("D3/C4 · bước Ký ondoc xong khi đủ ô Bên A, ô Bên B không chặn", async () => {
    const x = await world([REVIEW(w.G), ESIGN(`user:${w.A}`), WAIT], 2);
    const fa = await field(x, "A", "user", w.A);
    await field(x, "B", "partner", "doi-tac@example.com");
    expect((await turnOf(x, w.A)).step).toBe("sign");
    expect((await turnOf(x, w.B)).allowed).toBe(false);
    await flow.onDocSigned({ tenantId: w.T, userId: w.A }, x.id, x.runId);
    expect(fired).not.toContain(x.id);
    await sign(fa, await version(x, w.A), w.A);
    await flow.onDocSigned({ tenantId: w.T, userId: w.A }, x.id, x.runId);
    expect(fired).toContain(x.id);
  });

  it("Q8 · người duyệt kiêm người ký đã ký ô ở bước duyệt thì bước Ký tự xong", async () => {
    // Engine thật: mở stage chờ `esign.completed` (launchTimedWaitStage) với cổng gói thật `signWaitReady`.
    const open = async (x: X) => {
      const [st] = await o<
        { id: string }[]
      >`insert into hub.stage_runs (tenant_id, process_run_id, stage_idx, status)
        values (${w.T}, ${x.runId}, 2, 'running') returning id::text as id`;
      await withSystemScope(db, { kind: "system" }, (tx) =>
        launchTimedWaitStage(engineDeps, tx, {
          runId: x.runId,
          tenantId: w.T,
          stage: { id: st?.id as string, round: 1, attempt: 1 },
          hours: 336,
          event: "esign.completed",
        }),
      );
      const [r] = await o<{ got: boolean; due_now: boolean }[]>`select
        exists (select 1 from hub.process_run_events where process_run_id = ${x.runId} and event = 'esign.completed') as got,
        exists (select 1 from hub.process_timers where stage_run_id = ${st?.id as string} and due_at <= now() + interval '1 minute') as due_now`;
      return r;
    };
    const stages = [REVIEW(w.G), ESIGN(`group:${w.G}`), WAIT];
    const x = await world(stages, 2);
    const fa = await field(x, "A", "group", w.G);
    await sign(fa, await version(x, w.A), w.A);
    expect(await open(x)).toEqual({ got: true, due_now: true });
    const y = await world(stages, 2); // chưa ký ⇒ chờ như thường
    await field(y, "A", "group", w.G);
    expect(await open(y)).toEqual({ got: false, due_now: false });
  });

  it("Q17 · Chưa đạt quay lại bước trước cùng run thì bỏ bản đã ký của run", async () => {
    const x = await world([REVIEW(w.G)], 0);
    const fa = await field(x, "A", "user", w.A);
    await sign(fa, await version(x, w.A), w.A);
    await withSystemScope(db, { kind: "system" }, (tx) =>
      signOnBack(tx, { tenantId: w.T, runId: x.runId }),
    );
    const [r] = await o<{ voided: boolean; open: boolean }[]>`select
      (select voided_at is not null from contracts.sign_versions where contract_id = ${x.id}) as voided,
      (select signed_version_id is null from contracts.sign_fields where id = ${fa}) as open`;
    expect(r).toEqual({ voided: true, open: true });
    const e = { tenantId: w.T, runId: x.runId, actor: w.A };
    expect((await signFlowHooks.beforePass?.(e))?.missing).toEqual([x.fileId]);
  });

  it("Q17 · Trả lại thì các bản của lượt void và ô mở lại", async () => {
    const x = await world([REVIEW(w.G)], 0);
    const fa = await field(x, "A", "user", w.A);
    await sign(fa, await version(x, w.A), w.A);
    const aid = crypto.randomUUID();
    await o`insert into contracts.approvals (id, tenant_id, contract_id, status, started_by, mode)
      values (${aid}, ${w.T}, ${x.id}, 'level1', ${w.S}, 'engine')`;
    await o`update contracts.contracts set run_id = ${aid} where id = ${x.id}`;
    const input = {
      tenantId: w.T,
      ref: x.id,
      runId: x.runId,
      actorId: w.A,
      event: "contract.submitted",
      outcome: "returned",
    };
    const res = await withSystemScope(db, { kind: "system" }, (tx) =>
      applyContractOutcome(tx, input as never, "returned"),
    );
    expect(res).toBe("applied");
    const [v] = await o<{ voided: boolean }[]>`select voided_at is not null as voided
      from contracts.sign_versions where contract_id = ${x.id}`;
    const [f] = await o<{ open: boolean }[]>`select signed_version_id is null as open
      from contracts.sign_fields where id = ${fa}`;
    expect(v?.voided).toBe(true);
    expect(f?.open).toBe(true);
  });

  it("T2/C3 · Gửi duyệt bị chặn đúng lý do", async () => {
    const x = await world([REVIEW(w.G)], 0);
    const who = { tenantId: w.T, userId: w.S };
    const flows = [[REVIEW(w.G), ESIGN(`user:${w.A}`), WAIT]];
    expect(await signFlowHooks.submitCheck?.(who, x.id, flows)).toBe("sign_missing_fields");
    await field(x, "A", "user", w.A);
    expect(await signFlowHooks.submitCheck?.(who, x.id, flows)).toBeNull();
    await o`update contracts.sign_docs set needs_sign = false where contract_id = ${x.id}`;
    expect(await signFlowHooks.submitCheck?.(who, x.id, flows)).toBe("sign_no_files");
    // Q3 · bước chỉ ý kiến ⇒ không bắt tệp cần ký
    expect(await signFlowHooks.submitCheck?.(who, x.id, [[REVIEW(w.G, "opinion")]])).toBeNull();
  });

  it("Q1 · lưu quy trình có Ký qua ondoc không đòi nhà cung cấp ký số", async () => {
    const no = async (): Promise<never> => {
      throw new Error("không được gọi");
    };
    const api = esignNodeApi({
      settings: no,
      settingsOf: no,
      avail: () => null,
      directory: undefined,
    });
    expect(await api.checkNode(w.T, { provider: "ondoc" })).toEqual([]);
  });
});
