// CR-184 · ý (5) · uỷ quyền khi vắng (CR-127) chạy với «ký trên tài liệu» (CR-181). Cổng lượt ký THẬT (`signFlowOf` ⇒ `packRecordStepOf`),
// Lưu chữ ký THẬT (in PDF). A = người ký / người duyệt, B (hoặc X) = người được uỷ quyền, C = người bất kỳ, S = người tạo HĐ — N2.
// B ký bằng chữ ký CỦA B; bản ký ghi `on_behalf_of = A`; không có loại `esign` ⇒ không ký được bước Ký; hết hạn / thu hồi ⇒ không có lượt.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";
import { connectDb, type Db } from "../../lib/db";
import { type ClaimWorld, claimWorld, groupTask } from "../processes/testing/claim-seed";
import { signsOfQ } from "./contracts/adapters/approval-record-signs.repo";
import { contractFilesRepo } from "./contracts/adapters/contract-files.repo";
import { signDocRepo } from "./contracts/adapters/sign-doc.repo";
import { signDocsRepo } from "./contracts/adapters/sign-docs.repo";
import { signFieldsRepo } from "./contracts/adapters/sign-fields.repo";
import { sha256Hex, stampPdf } from "./contracts/adapters/sign-stamp.pdf";
import { signVersionsRepo } from "./contracts/adapters/sign-versions.repo";
import type { SignDocRepos } from "./contracts/application/sign-doc.ports";
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
  c.getContext("2d").fillRect(10, 10, 80, 20);
  return c.toBuffer("image/png");
};
// Mỗi người một chữ ký RIÊNG (id khác nhau) — để chứng minh B không dùng chữ ký của A (BR-K2/K3).
const SIG_OF = new Map<string, { id: string; png: Uint8Array }>();

const ONDOC = (uid: string) => [
  {
    key: "ky",
    name: "Ký",
    step: 0,
    after: { kind: "auto" },
    executor: {
      kind: "tool",
      tool_key: "contracts-esign-send",
      args: {
        provider: { from: "const", value: "ondoc" },
        company_signers: { from: "const", value: `user:${uid}` },
      },
    },
  },
];
const REVIEW = [
  { key: "duyet", name: "Duyệt", step: 0, after: { kind: "review", evidence: "opinion_plus" } },
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
      prepare: async (who) => ({
        settings: { ink: "blue", caption: ["name"], initials: "shrink" },
        name: "Người ký",
        title: null,
        main: SIG_OF.get(who.userId) ?? null,
        initials: null,
      }),
      audit: async () => undefined,
      userNames: async (_w, ids) => new Map(ids.map((i) => [i, i])),
    },
    turn: flow.turn,
    companySigners: async () => [{ kind: "user", id: w.A, name: "A" }],
    onDocEnabled: async () => true,
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

/** HĐ (S tạo) + tệp PDF cần ký + ô Bên A của A + lượt đang ở bước `stages[0]`. */
async function world(stages: unknown[]) {
  const d = await PDFDocument.create();
  d.addPage([595, 842]);
  const bytes = await d.save();
  const boxId = `fb-${crypto.randomUUID()}`;
  boxes.set(boxId, bytes);
  const { runId, taskId } = await groupTask(o, w, w.G);
  const [f] = await o<{ id: string }[]>`insert into contracts.files
      (tenant_id, org, file_id, name, mime, size_bytes, created_by)
    values (${w.T}, ${`t_${w.T}`}, ${boxId}, 'hd.pdf', 'application/pdf', ${bytes.byteLength}, ${w.S})
    returning id::text as id`;
  const fileId = f?.id as string;
  const [c] = await o<
    { id: string }[]
  >`insert into contracts.contracts (tenant_id, title, created_by, status, file_id)
    values (${w.T}, 'HĐ uỷ quyền', ${w.S}, 'processing', ${fileId}) returning id::text as id`;
  const id = c?.id as string;
  await o`insert into contracts.sign_docs (tenant_id, contract_id, file_id, needs_sign, pages, set_by)
    values (${w.T}, ${id}, ${fileId}, true, 1, ${w.S})`;
  const [fa] = await o<{ id: string }[]>`insert into contracts.sign_fields
      (tenant_id, contract_id, file_id, side, signer_kind, signer_ref, label, parts, created_by)
    values (${w.T}, ${id}, ${fileId}, 'A', 'user', ${w.A}, 'A', ${o.json([PART] as never)}, ${w.S})
    returning id::text as id`;
  await o`update hub.process_runs set pack_key = 'contracts', pack_record_id = ${id}, status = 'running',
      snapshot = jsonb_set(snapshot, '{stages}', ${o.json(stages as never)}), current_stage_idx = 0
    where id = ${runId}`;
  return { id, fileId, runId, taskId, fieldA: fa?.id as string };
}

const DAY = 86_400_000;
/** Uỷ quyền A → `to` (mặc định B): còn hiệu lực / hết hạn (`ended`) / đã thu hồi (`revoked`). Mỗi lần thay hàng cũ của công ty. */
async function deleg(
  kinds: string[],
  opt: { to?: string; ended?: boolean; revoked?: boolean; by?: string } = {},
) {
  const now = Date.now();
  const from = new Date(now - (opt.ended ? 3 : 1) * DAY).toISOString();
  const to = new Date(now + (opt.ended ? -2 : 1) * DAY).toISOString();
  const revoked = opt.revoked ? new Date(now).toISOString() : null;
  await o`delete from hub.delegations where tenant_id = ${w.T}`;
  await o`insert into hub.delegations (tenant_id, from_user_id, to_user_id, from_at, to_at, kinds, created_by, revoked_at)
    values (${w.T}, ${w.A}, ${opt.to ?? w.B}, ${from}::timestamptz, ${to}::timestamptz, ${`{${kinds.join(",")}}`}::text[], ${opt.by ?? w.A},
      ${revoked}::timestamptz)`;
}
const turnOf = (id: string, u: string) => flow.turn.turnFor({ tenantId: w.T, userId: u }, id, u);
const ctx = (u: string) => ({ tenantId: w.T, userId: u });
const markField = (fieldId: string) => ({
  kind: "internal" as const,
  marks: [{ field_id: fieldId, placement: "field" as const, parts: [PART], caption: true }],
});
const versionOf = async (contractId: string) => {
  const [v] = await o<
    { by: string; behalf: string | null; sig: string }[]
  >`select v.signed_by::text as by, v.on_behalf_of::text as behalf, m.user_signature_id::text as sig
    from contracts.sign_versions v join contracts.sign_marks m on m.version_id = v.id where v.contract_id = ${contractId}`;
  return v;
};

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  w = await claimWorld(o, 9871);
  await o`insert into hub.signature_settings (tenant_id, on_doc_enabled) values (${w.T}, true)
    on conflict (tenant_id) do update set on_doc_enabled = true`;
  flow = signFlowOf(db);
  for (const u of [w.A, w.B, w.X]) SIG_OF.set(u, { id: crypto.randomUUID(), png: png() });
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-184 · bước Ký ondoc + uỷ quyền loại «Ký hợp đồng» (esign)", () => {
  it("A uỷ quyền esign cho B ⇒ B có lượt, Lưu bằng chữ ký CỦA B, bản ký ghi «thay A», hồ sơ duyệt đọc được «thay A»", async () => {
    const x = await world(ONDOC(w.A));
    await deleg(["esign"]);
    const t = await turnOf(x.id, w.B);
    expect(t.allowed).toBe(true);
    expect(t.step).toBe("sign");
    expect(t.behalf?.map((b) => b.user_id)).toEqual([w.A]);
    const r = await save().sign(ctx(w.B), x.id, x.fileId, markField(x.fieldA));
    expect(r.my_open_fields_left).toBe(0);
    expect(await versionOf(x.id)).toEqual({
      by: w.B,
      behalf: w.A,
      sig: SIG_OF.get(w.B)?.id as string,
    });
    const [f] = await o<
      { by: string | null }[]
    >`select signed_by::text as by from contracts.sign_fields where id = ${x.fieldA}`;
    expect(f?.by).toBe(w.B); // ô vẫn là chỗ của A (signer_ref), người ký thật là B
    const rows = await createPackUow(db, "contracts", (tx, tid) => ({
      signs: signsOfQ(tx, tid),
    })).system(w.T, (r) => r.signs(x.id));
    expect(rows.map((s) => [s.signedBy, s.onBehalfOf])).toEqual([[w.B, w.A]]);
  });

  it("A chỉ uỷ quyền approve (không chọn esign) ⇒ B KHÔNG ký được bước Ký", async () => {
    const x = await world(ONDOC(w.A));
    await deleg(["approve"]);
    expect(await turnOf(x.id, w.B)).toEqual({ allowed: false, reason: "NOT_SIGNER" });
    await expect(save().sign(ctx(w.B), x.id, x.fileId, markField(x.fieldA))).rejects.toThrow(
      "forbidden",
    );
  });

  it("uỷ quyền hết hạn hoặc đã thu hồi ⇒ không có lượt", async () => {
    const x = await world(ONDOC(w.A));
    await deleg(["esign"], { ended: true });
    expect((await turnOf(x.id, w.B)).allowed).toBe(false);
    await deleg(["esign"], { revoked: true });
    expect((await turnOf(x.id, w.B)).allowed).toBe(false);
  });

  it("quản trị đặt uỷ quyền THAY A (created_by ≠ A) ⇒ B vẫn có lượt và bản ký ghi «thay A»", async () => {
    const x = await world(ONDOC(w.A));
    await deleg(["esign"], { by: w.TA });
    const t = await turnOf(x.id, w.B);
    expect(t.allowed).toBe(true);
    expect(t.behalf?.map((b) => b.user_id)).toEqual([w.A]);
    await save().sign(ctx(w.B), x.id, x.fileId, markField(x.fieldA));
    expect((await versionOf(x.id))?.behalf).toBe(w.A);
  });

  it("người C bất kỳ (và người tạo HĐ) ⇒ không có lượt dù A đã uỷ quyền cho B; A vẫn giữ lượt", async () => {
    const x = await world(ONDOC(w.A));
    await deleg(["esign"]);
    expect((await turnOf(x.id, w.X)).allowed).toBe(false);
    expect((await turnOf(x.id, w.S)).allowed).toBe(false);
    expect((await turnOf(x.id, w.A)).allowed).toBe(true);
  });
});

describe("CR-184 · bước Duyệt có chữ ký + uỷ quyền loại «Duyệt» (approve)", () => {
  /** Task duyệt giao ĐÍCH DANH A; X (ngoài nhóm) có hàng `via='delegated'` thay A (như `insertGrants`). */
  async function approveWorld() {
    const x = await world(REVIEW);
    await o`delete from hub.review_task_assignees where task_id = ${x.taskId}`;
    await o`update hub.review_tasks set assignee_group_id = null where id = ${x.taskId}`;
    await o`insert into hub.review_task_assignees (tenant_id, task_id, user_id, via, depth)
      values (${w.T}, ${x.taskId}, ${w.A}, 'initial', 0)`;
    await o`insert into hub.review_task_assignees (tenant_id, task_id, user_id, via, depth, on_behalf_of)
      values (${w.T}, ${x.taskId}, ${w.X}, 'delegated', 0, ${w.A})`;
    return x;
  }

  it("A uỷ quyền approve cho X ⇒ X có lượt approve, Lưu bằng chữ ký CỦA X, bản ký ghi «thay A»", async () => {
    const x = await approveWorld();
    await deleg(["approve"], { to: w.X });
    const t = await turnOf(x.id, w.X);
    expect(t.step).toBe("approve");
    expect(t.behalf?.map((b) => b.user_id)).toEqual([w.A]);
    await save().sign(ctx(w.X), x.id, x.fileId, {
      kind: "internal",
      marks: [{ placement: "free", parts: [PART], caption: true }],
    });
    expect(await versionOf(x.id)).toEqual({
      by: w.X,
      behalf: w.A,
      sig: SIG_OF.get(w.X)?.id as string,
    });
  });

  it("thu hồi uỷ quyền ⇒ X hết lượt; người tạo HĐ không có lượt; A tự duyệt không ghi «thay»", async () => {
    const x = await approveWorld();
    await deleg(["approve"], { to: w.X, revoked: true });
    expect((await turnOf(x.id, w.X)).allowed).toBe(false);
    expect((await turnOf(x.id, w.S)).allowed).toBe(false);
    const a = await turnOf(x.id, w.A);
    expect(a.allowed).toBe(true);
    expect(a.behalf).toBeUndefined();
  });
});
