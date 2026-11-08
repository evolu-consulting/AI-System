// CR-125 · cr125-contract-from-step · node «Tạo hợp đồng từ hồ sơ», DB thật (pool hub_api, role contracts_rw): tệp của bước Soạn thảo → HĐ trong Sổ
// Hợp Tác của công ty của lượt (use case tải lên THẬT, kho tệp + bộ đếm giả; lượt + liên kết lượt↔HĐ THẬT trong hub) → Ký số (selfsign) chỉ ký đúng
// HĐ của lượt. Chặn: tệp không liên kết với lượt, tệp công ty khác, HĐ không phải bản ghi của lượt (không bỏ qua duyệt), hai lời gọi đồng thời.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db, type Tx } from "@ai/db";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { attachmentBytesOf } from "../attachments/public";
import { packRecordPort } from "../processes/public";
import { contractFlowRepo } from "./contracts/adapters/contract-flow.repo";
import { createFromStepTool } from "./contracts/adapters/create-from-step.tool";
import { esignRepo } from "./contracts/adapters/esign.repo";
import { selfsignProvider } from "./contracts/adapters/esign.selfsign";
import { extractionRepo } from "./contracts/adapters/extraction.repo";
import { intakeTools } from "./contracts/adapters/intake.tools";
import { uploadContractRepo } from "./contracts/adapters/upload-contract.repo";
import type { ESignFiles } from "./contracts/application/esign.ports";
import { createUploadContract } from "./contracts/application/upload-contract.usecase";
import { esignModule } from "./contracts/esign.mount";
import { createPackUow } from "./kit/adapters/pack-uow";
import { nodeConfigRegistry, packTenantOnly } from "./kit/public";

let o: Sql;
let db: Db;
let T1 = "";
let T2 = "";
let A = "";
let X = "";
let DEF = "";
const PDF = new TextEncoder().encode("%PDF-1.4\n%%EOF\n");
const FILE = "0c125000-0000-4000-8000-0000000000f1";

const files: ESignFiles = () => ({
  getContent: async () => PDF,
  postFile: async () => ({ fileId: "f", versionId: "v" }),
  getLink: async () => null,
  deleteFile: async () => null,
});

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [T1, T2] = (await tenants(o, 2, 981)) as [string, string];
  [A] = (await users(o, T1, 1, { from: 981 })) as [string];
  [X] = (await users(o, T2, 1, { from: 991 })) as [string];
  const [d] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, description, input_hint,
      run_group_ids, stages, token_budget, enabled, sources, inputs, slot, slot_body, published_version)
    select null, 'cfs-int', 'Quy trình mồi', description, input_hint, run_group_ids, stages, token_budget, enabled,
      sources, inputs, slot, slot_body, 1
    from hub.process_defs where tenant_id is null and deleted_at is null limit 1 returning id::text as id`;
  DEF = d?.id as string;
  db = createDb(urls().hubApi, { max: 6 });
}, 60_000);
afterAll(async () => {
  nodeConfigRegistry.clear("contracts-esign-send");
  await db?.close();
  await o?.end({ timeout: 2 });
});

/** Một lượt chạy thật của hub (chưa gắn bản ghi gói). */
async function mkRun(tenant: string, user: string): Promise<string> {
  const [c] = await o<
    { id: string }[]
  >`insert into hub.conversations (tenant_id, user_id, title, title_norm)
    values (${tenant}, ${user}, 'c', 'c') returning id::text as id`;
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_runs (tenant_id, process_def_id, def_version, snapshot,
      started_by, origin_kind, input, conversation_id, flow_id, expires_at)
    values (${tenant}, ${DEF}, 1, '{}'::jsonb, ${user}, 'admin', 'x', ${c?.id as string}, gen_random_uuid(),
      now() + interval '1 day') returning id::text as id`;
  return r?.id as string;
}

const port = () => packRecordPort({ db } as never);

function makeTool(linked: ReadonlySet<string>, uploads: { n: number } = { n: 0 }) {
  const uow = packTenantOnly(
    createPackUow(db, "contracts", (tx: Tx, t: string) => ({
      upload: uploadContractRepo(tx, t),
      contractFlow: contractFlowRepo(tx, t),
    })),
  );
  const upload = createUploadContract({
    uow,
    counter: { take: async () => ({ tenant: 1, global: 1 }), refund: async () => undefined },
    files: {
      put: async () => ({ fileId: `fb${++uploads.n}`, versionId: `v${uploads.n}` }),
      remove: async () => undefined,
    },
    docx: { toMarkdown: async () => ({ ok: true, markdown: "", warnings: [] }) },
    starter: { start: async () => undefined },
    zipNames: () => [],
    limits: { tenant: 100, global: 1000 },
    newId: () => Bun.randomUUIDv7(),
  });
  return createFromStepTool({
    upload,
    // Kho tệp hub giả: chỉ tệp ĐÃ liên kết với lượt (`tenant:run:file`) — như `attachmentBytesOf` thật (test riêng bên dưới).
    readFile: async (tenantId, runId, id) =>
      linked.has(`${tenantId}:${runId}:${id}`) ? { name: "hd.pdf", bytes: PDF } : null,
    timeZoneOf: async () => "Asia/Ho_Chi_Minh",
    link: { once: (t, r, create) => port().linkOnce(t, r, "contracts", create) },
  });
}
const ctx = (tenantId: string, userId: string, processRunId: string | null) => ({
  tenantId,
  userId,
  runId: null,
  processRunId,
});
const count = async (t: string) =>
  Number(
    (await o`select count(*)::int as n from contracts.contracts where tenant_id = ${t}`)[0]?.n,
  );

function esignSend() {
  const u = esignModule(db, { esign: { providers: [selfsignProvider()] }, files });
  const uow = createPackUow(db, "contracts", (tx: Tx, t: string) => ({
    extraction: extractionRepo(tx, t),
    esign: esignRepo(tx, t),
  }));
  const send = intakeTools({
    uow,
    send: u.sendSystem,
    nodeSigners: u.resolveNodeSigners,
    parsePartner: () => null,
    recordOfRun: (t, r) => port().recordOf(t, r, "contracts"),
  }).find((t) => t.name === "contracts-esign-send");
  return { u, send };
}

describe("contracts-create-from-step", () => {
  it("tệp bước Soạn thảo → HĐ của công ty lượt, lượt gắn HĐ → Ký số (selfsign) ký đúng HĐ đó", async () => {
    const run = await mkRun(T1, A);
    const tool = makeTool(new Set([`${T1}:${run}:${FILE}`]));
    const r = (await tool.run(ctx(T1, A, run), {
      file_id: FILE,
      title: "HĐ mua máy",
      counterparty: "Công ty A",
      amount: 12_000_000,
    })) as { status: string; contract_id: string };
    expect(r.status).toBe("created");
    const [c] = await o`select tenant_id, title, status, fields->'total_value'->>'value' as v,
        fields->'supplier_name'->>'value' as supplier, file_id from contracts.contracts where id = ${r.contract_id}`;
    expect(c).toMatchObject({
      tenant_id: T1,
      title: "HĐ mua máy",
      status: "needs_review",
      v: "12000000",
      supplier: "Công ty A",
    });
    expect(c?.file_id).not.toBeNull();
    const [pr] =
      await o`select pack_key, pack_record_id::text as rid from hub.process_runs where id = ${run}`;
    expect(pr).toMatchObject({ pack_key: "contracts", rid: r.contract_id }); // lượt gắn HĐ
    expect(await count(T2)).toBe(0); // cách ly công ty
    // thử lại cùng lượt ⇒ trả lại HĐ cũ, không tạo đôi
    const again = (await tool.run(ctx(T1, A, run), { file_id: FILE })) as {
      contract_id: string;
      status: string;
    };
    expect(again).toMatchObject({ status: "exists", contract_id: r.contract_id });

    const { u, send } = esignSend();
    await u.saveSettings(
      { tenantId: T1, userId: A },
      { enabled: true, default_provider: "selfsign" },
    );
    await send?.run(ctx(T1, A, run), {
      contract_id: r.contract_id,
      company_signers: `user:${A}`,
      partner_signs: false,
    });
    const [e] =
      await o`select provider from contracts.esign_envelopes where contract_id = ${r.contract_id}`;
    expect(e?.provider).toBe("selfsign");
    const [l] =
      await o`select locked_at is not null as l from contracts.contracts where id = ${r.contract_id}`;
    expect(l?.l).toBe(true);
  });

  it("hai lời gọi đồng thời cùng lượt ⇒ MỘT hợp đồng", async () => {
    const run = await mkRun(T1, A);
    const tool = makeTool(new Set([`${T1}:${run}:${FILE}`]));
    const before = await count(T1);
    const [a, b] = (await Promise.all([
      tool.run(ctx(T1, A, run), { file_id: FILE }),
      tool.run(ctx(T1, A, run), { file_id: FILE }),
    ])) as { status: string; contract_id: string }[];
    expect(a?.contract_id).toBe(b?.contract_id as string);
    expect([a?.status, b?.status].sort()).toEqual(["created", "exists"]);
    expect(await count(T1)).toBe(before + 1);
  });

  it("không có tệp / tệp chưa liên kết với lượt / công ty khác ⇒ CONTRACT_STEP_FILE_MISSING, không tạo gì", async () => {
    const run = await mkRun(T1, A);
    const runX = await mkRun(T2, X);
    const tool = makeTool(new Set([`${T1}:${run}:${FILE}`]));
    const before = await count(T1);
    await expect(tool.run(ctx(T1, A, run), { title: "x" })).rejects.toThrow(
      "CONTRACT_STEP_FILE_MISSING",
    );
    const other = "0c125000-0000-4000-8000-0000000000f2"; // tệp của công ty nhưng KHÔNG liên kết với lượt
    await expect(tool.run(ctx(T1, A, run), { file_id: other })).rejects.toThrow(
      "CONTRACT_STEP_FILE_MISSING",
    );
    await expect(tool.run(ctx(T2, X, runX), { file_id: FILE })).rejects.toThrow(
      "CONTRACT_STEP_FILE_MISSING",
    );
    expect(await count(T1)).toBe(before);
    expect(await count(T2)).toBe(0);
    const [pr] = await o`select pack_key from hub.process_runs where id = ${run}`;
    expect(pr?.pack_key).toBeNull(); // lỗi ⇒ lượt không bị gắn
  });

  it("attachmentBytesOf: chỉ tệp đã liên kết với lượt (hub.process_run_files) đọc được", async () => {
    const run = await mkRun(T1, A);
    const mk = async () => {
      const id = crypto.randomUUID();
      await o`insert into hub.attachments (id, tenant_id, user_id, origin, filename, safe_name, mime, size, sha256, storage_key)
        values (${id}, ${T1}, ${A}, 'upload', 'hd.pdf', 'hd.pdf', 'application/pdf', 16, ${"a".repeat(64)}, ${`${T1}/${id}`})`;
      return id;
    };
    const linked = await mk();
    const stray = await mk(); // cùng công ty, cùng người, KHÔNG liên kết với lượt
    await o`insert into hub.process_run_files (process_run_id, attachment_id, tenant_id, linked_by, source)
      values (${run}, ${linked}, ${T1}, ${A}, 'form')`;
    const read = attachmentBytesOf(db, { blob: async () => new Blob([PDF]) } as never);
    expect((await read(T1, run, linked))?.bytes.length).toBe(PDF.length);
    expect(await read(T1, run, stray)).toBeNull();
    expect(await read(T2, run, linked)).toBeNull(); // sai công ty
  });

  it("Ký số từ chối HĐ không phải bản ghi của lượt (không bỏ qua duyệt): HĐ tải lên chưa gửi duyệt không bị khoá/ký", async () => {
    const run = await mkRun(T1, A);
    const [id] = await contracts(o, T1, 1, { from: 985, createdBy: A, owner: A });
    await o`update contracts.contracts set status = 'needs_review', locked_at = null, locked_by = null, confirmed_at = null where id = ${id as string}`;
    const { u, send } = esignSend();
    await u.saveSettings(
      { tenantId: T1, userId: A },
      { enabled: true, default_provider: "selfsign" },
    );
    const args = { contract_id: id as string, company_signers: `user:${A}`, partner_signs: false };
    await expect(send?.run(ctx(T1, A, run), args)).rejects.toThrow("ESIGN_CONTRACT_NOT_IN_RUN");
    await expect(send?.run(ctx(T1, A, null), args)).rejects.toThrow("ESIGN_CONTRACT_NOT_IN_RUN");
    const [l] =
      await o`select locked_at is not null as l from contracts.contracts where id = ${id as string}`;
    expect(l?.l).toBe(false);
    expect(
      (await o`select 1 from contracts.esign_envelopes where contract_id = ${id as string}`).length,
    ).toBe(0);
  });
});
