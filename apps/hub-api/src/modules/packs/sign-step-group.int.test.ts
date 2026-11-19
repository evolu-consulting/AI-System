// CR-181 · fix-cr181-signstep · e2e K07: bước Ký `ondoc` có người ký công ty là NHÓM (Q2). Một thành viên nhóm Lưu ô «Đại diện <nhóm>»
// qua use case Lưu THẬT (in PDF thật) ⇒ ô đã ký và bước chờ `esign.completed` được thả bằng ENGINE THẬT (`launchTimedWaitStage` mở bước,
// `signalPackEvent` thả bước). Người ký (A, thành viên nhóm G) khác người tạo HĐ (S) — N2.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withHubScope } from "@ai/db/hub-scope";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";
import { connectDb, type Db } from "../../lib/db";
import { createHubUow } from "../processes/adapters/hub-uow";
import { signalPackEvent } from "../processes/runs/pack-signal";
import { launchTimedWaitStage } from "../processes/runs/wait-timed-launch";
import { type ClaimWorld, claimWorld, groupTask } from "../processes/testing/claim-seed";
import { contractFilesRepo } from "./contracts/adapters/contract-files.repo";
import { signDocRepo } from "./contracts/adapters/sign-doc.repo";
import { signDocsRepo } from "./contracts/adapters/sign-docs.repo";
import { signFieldsRepo } from "./contracts/adapters/sign-fields.repo";
import { signWaitReady } from "./contracts/adapters/sign-flow.engine";
import { sha256Hex, stampPdf } from "./contracts/adapters/sign-stamp.pdf";
import { signVersionsRepo } from "./contracts/adapters/sign-versions.repo";
import type { SignDocRepos } from "./contracts/application/sign-doc.ports";
import { signFlowHooks } from "./contracts/application/sign-flow.hooks";
import { signSaveUsecases } from "./contracts/application/sign-save.usecase";
import { noDigitalSigner, produceSigned } from "./contracts/domain/digital-signer";
import { createPackUow } from "./kit/adapters/pack-uow";
import type { PackUow } from "./kit/public";
import { type SignFlow, signFlowOf } from "./packs.sign-doc";

let o: Sql;
let db: Db;
let w: ClaimWorld;
let flow: SignFlow;
const boxes = new Map<string, Uint8Array>();
const PART = { page: 0, x: 40, y: 40, w: 120, h: 50, cx: 40, cy: 40, cw: 120, ch: 50 };
const png = (): Uint8Array => {
  const c = createCanvas(120, 50);
  const g = c.getContext("2d");
  g.fillRect(10, 10, 80, 20);
  return c.toBuffer("image/png");
};
const SIG = {
  id: "5160a000-0000-4000-8000-0000000000c1",
  png: png(),
  caption: "Giám đốc" as string | null,
};

const stages = (g: string) => [
  {
    key: "duyet",
    name: "Duyệt",
    step: 0,
    after: { kind: "review", group_id: g, evidence: "opinion_plus" },
  },
  {
    key: "ky",
    name: "Ký",
    step: 1,
    after: { kind: "auto" },
    executor: {
      kind: "tool",
      tool_key: "contracts-esign-send",
      args: {
        provider: { from: "const", value: "ondoc" },
        company_signers: { from: "const", value: `group:${g}` },
      },
    },
  },
  {
    key: "cho",
    name: "Chờ ký",
    step: 2,
    after: { kind: "auto" },
    executor: { kind: "wait_event", event: "esign.completed", timeout_h: 168 },
  },
];

const uow = () =>
  createPackUow(db, "contracts", (tx, t) => ({
    contractFiles: contractFilesRepo(tx, t),
    signDoc: signDocRepo(tx, t),
    docs: signDocsRepo(tx, t),
    fields: signFieldsRepo(tx, t),
    versions: signVersionsRepo(tx, t),
  })) as never as PackUow<SignDocRepos>;

const save = () =>
  signSaveUsecases({
    uow: uow(),
    files: {
      read: async (_o, id) => boxes.get(id) ?? null,
      put: async (_o, _n, bytes) => {
        const fileId = `out-${Bun.randomUUIDv7()}`;
        boxes.set(fileId, bytes);
        return { fileId, versionId: "v1" };
      },
      remove: async (_o, id) => void boxes.delete(id),
    },
    maxBytes: 50_000_000,
    hub: {
      prepare: async () => ({
        settings: { ink: "blue", initials: "shrink" },
        main: SIG,
        initials: null,
      }),
      audit: async () => undefined,
      userNames: async (_w, ids) => new Map(ids.map((i) => [i, "Giám đốc"])),
    },
    turn: flow.turn,
    // Q2 · người ký công ty = nhóm G; «mine» theo thành viên nhóm (như `signDocPorts.companySigners`).
    companySigners: async (who) => [
      {
        kind: "group",
        id: w.G,
        name: "Người ký hợp đồng",
        mine: (w.groupsOf.get(who.userId) ?? []).includes(w.G),
      },
    ],
    onDocEnabled: async () => true,
    onSigned: flow.onDocSigned,
    produce: (i) =>
      produceSigned({
        pdf: i.pdf,
        marks: i.marks,
        ink: i.ink,
        kind: i.kind,
        signer: noDigitalSigner,
        stamp: stampPdf,
        sha256: sha256Hex,
      }),
    newId: () => Bun.randomUUIDv7(),
    now: () => new Date(),
    orgOf: (t) => `t_${t}`,
  });

/** HĐ (S tạo) + tệp PDF cần ký + ô Bên A của NHÓM + ô Bên B + lượt engine đang ở bước Ký (stage chờ mở bằng engine thật). */
async function world(openWait = true) {
  const d = await PDFDocument.create();
  d.addPage([595, 842]);
  const bytes = await d.save();
  const boxId = `fb-${crypto.randomUUID()}`;
  boxes.set(boxId, bytes);
  const { runId } = await groupTask(o, w, w.G);
  const [f] = await o<{ id: string }[]>`insert into contracts.files
      (tenant_id, org, file_id, name, mime, size_bytes, created_by)
    values (${w.T}, ${`t_${w.T}`}, ${boxId}, 'hd.pdf', 'application/pdf', ${bytes.byteLength}, ${w.S})
    returning id::text as id`;
  const fileId = f?.id as string;
  const [c] = await o<
    { id: string }[]
  >`insert into contracts.contracts (tenant_id, title, created_by, status, file_id)
    values (${w.T}, 'HĐ nhóm ký', ${w.S}, 'processing', ${fileId}) returning id::text as id`;
  const id = c?.id as string;
  await o`insert into contracts.sign_docs (tenant_id, contract_id, file_id, needs_sign, pages, set_by)
    values (${w.T}, ${id}, ${fileId}, true, 1, ${w.S})`;
  const [fa] = await o<{ id: string }[]>`insert into contracts.sign_fields
      (tenant_id, contract_id, file_id, side, signer_kind, signer_ref, label, parts, created_by)
    values (${w.T}, ${id}, ${fileId}, 'A', 'group', ${w.G}, 'Đại diện Người ký hợp đồng', ${o.json([PART] as never)}, ${w.S})
    returning id::text as id`;
  await o`insert into contracts.sign_fields
      (tenant_id, contract_id, file_id, side, signer_kind, signer_ref, label, parts, created_by)
    values (${w.T}, ${id}, ${fileId}, 'B', 'partner', 'doi-tac@example.com', 'Đối tác', ${o.json([PART] as never)}, ${w.S})`;
  await o`update hub.process_runs set pack_key = 'contracts', pack_record_id = ${id},
      snapshot = jsonb_set(snapshot, '{stages}', ${o.json(stages(w.G) as never)}), current_stage_idx = ${openWait ? 2 : 1},
      status = 'running'
    where id = ${runId}`;
  // bước Duyệt đã xong (Đạt) — như run thật đã qua bước 0.
  await o`update hub.review_tasks set status = 'closed', result = 'pass', decided_by = ${w.A}, decided_at = now()
    where process_run_id = ${runId}`;
  await o`update hub.stage_runs set status = 'done' where process_run_id = ${runId} and stage_idx = 0`;
  const [st] = await o<
    { id: string }[]
  >`insert into hub.stage_runs (tenant_id, process_run_id, stage_idx, status)
    values (${w.T}, ${runId}, 2, 'running') returning id::text as id`;
  const stageId = st?.id as string;
  const deps = {
    now: () => new Date(),
    log: { warn: () => {}, info: () => {}, error: () => {} },
    packWaitReady: (tx: never, e: Parameters<typeof signWaitReady>[1]) => signWaitReady(tx, e),
  } as never;
  const open = () =>
    withHubScope(db, { kind: "system" }, (tx) =>
      launchTimedWaitStage(deps, tx, {
        runId,
        tenantId: w.T,
        stage: { id: stageId, round: 1, attempt: 1 },
        hours: 168,
        event: "esign.completed",
      }),
    );
  if (openWait) await open();
  return { id, fileId, runId, stageId, fieldA: fa?.id as string, open };
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  w = await claimWorld(o, 9861);
  await o`insert into hub.signature_settings (tenant_id, on_doc_enabled) values (${w.T}, true)
    on conflict (tenant_id) do update set on_doc_enabled = true`;
  flow = signFlowOf(db);
  const sys = createHubUow(db, { clock: { now: () => new Date() }, publish: async () => {} });
  // Engine THẬT: cùng đường `PackRunsPort.signalEvent` mà `intake.mount` nối cho `signFlowHooks.completed`.
  signFlowHooks.completed = async (tenantId, contractId, data) => {
    await signalPackEvent({ db, now: () => new Date() } as never, sys as never, {
      tenantId,
      ref: { pack: "contracts", record_id: contractId },
      event: "esign.completed",
      data,
    });
  };
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-181 · bước Ký ondoc, người ký công ty là nhóm (e2e K07)", () => {
  it("thành viên nhóm Lưu ô Đại diện nhóm thì ô đã ký và bước Ký xong", async () => {
    const x = await world();
    expect((await flow.turn.turnFor({ tenantId: w.T, userId: w.A }, x.id, w.A)).step).toBe("sign");
    const r = await save().sign({ tenantId: w.T, userId: w.A }, x.id, x.fileId, {
      kind: "internal",
      marks: [{ field_id: x.fieldA, placement: "field", parts: [PART], caption: true }],
    });
    expect(r.my_open_fields_left).toBe(0);
    const [f] = await o<
      { signed: boolean; by: string | null }[]
    >`select signed_version_id is not null as signed,
      signed_by::text as by from contracts.sign_fields where id = ${x.fieldA}`;
    expect(f).toEqual({ signed: true, by: w.A });
    const [s] = await o<
      { status: string }[]
    >`select status from hub.stage_runs where id = ${x.stageId}`;
    expect(s?.status).toBe("done");
  });

  it("Lưu khi lượt còn ở stage tool (bước chờ chưa mở) thì bước chờ mở ra là xong ngay", async () => {
    const x = await world(false);
    const turn = await flow.turn.turnFor({ tenantId: w.T, userId: w.A }, x.id, w.A);
    expect(turn.step).toBe("sign");
    await save().sign({ tenantId: w.T, userId: w.A }, x.id, x.fileId, {
      kind: "internal",
      marks: [{ field_id: x.fieldA, placement: "field", parts: [PART], caption: true }],
    });
    const [f] = await o<{ signed: boolean }[]>`select signed_version_id is not null as signed
      from contracts.sign_fields where id = ${x.fieldA}`;
    expect(f?.signed).toBe(true);
    await o`update hub.process_runs set current_stage_idx = 2 where id = ${x.runId}`;
    await x.open();
    const [r] = await o<{ got: boolean; due_now: boolean }[]>`select
      exists (select 1 from hub.process_run_events where process_run_id = ${x.runId} and event = 'esign.completed') as got,
      exists (select 1 from hub.process_timers where stage_run_id = ${x.stageId} and due_at <= now() + interval '1 minute') as due_now`;
    expect(r).toEqual({ got: true, due_now: true });
  });
});
