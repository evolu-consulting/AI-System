// CR-125 · cr125-contract-from-step · node «Tạo hợp đồng từ hồ sơ», DB thật (pool hub_api, role contracts_rw): tệp của bước Soạn thảo → HĐ trong Sổ
// Hợp Tác của công ty của lượt (qua use case tải lên THẬT, kho tệp + bộ đếm giả) → bước Ký số nhận đúng HĐ đó (selfsign) ⇒ phong bì ký tạo ra.
// Cách ly công ty: HĐ chỉ nằm ở công ty của lượt; tệp của công ty khác không đọc được ⇒ lỗi «Chưa có file». Lượt gắn HĐ ⇒ thử lại không tạo đôi.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db, type Tx } from "@ai/db";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createPackUow } from "../../kit/adapters/pack-uow";
import { nodeConfigRegistry, packTenantOnly } from "../../kit/public";
import type { ESignFiles } from "../application/esign.ports";
import { createUploadContract } from "../application/upload-contract.usecase";
import { esignModule } from "../esign.mount";
import { contractFlowRepo } from "./contract-flow.repo";
import { createFromStepTool } from "./create-from-step.tool";
import { esignRepo } from "./esign.repo";
import { selfsignProvider } from "./esign.selfsign";
import { extractionRepo } from "./extraction.repo";
import { intakeTools } from "./intake.tools";
import { uploadContractRepo } from "./upload-contract.repo";

let o: Sql;
let db: Db;
let T1 = "";
let T2 = "";
let A = "";
let X = "";
const PDF = new TextEncoder().encode("%PDF-1.4\n%%EOF\n");
const FILE_T1 = "0c125000-0000-4000-8000-0000000000f1";
const RUN = "0c125000-0000-4000-8000-0000000000e1";

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
  db = createDb(urls().hubApi, { max: 4 });
}, 60_000);
afterAll(async () => {
  nodeConfigRegistry.clear("contracts-esign-send");
  await db?.close();
  await o?.end({ timeout: 2 });
});

function setup(attached: Map<string, string>) {
  const uow = packTenantOnly(
    createPackUow(db, "contracts", (tx: Tx, t: string) => ({
      upload: uploadContractRepo(tx, t),
      contractFlow: contractFlowRepo(tx, t),
    })),
  );
  let n = 0;
  const upload = createUploadContract({
    uow,
    counter: { take: async () => ({ tenant: 1, global: 1 }), refund: async () => undefined },
    files: {
      put: async () => ({ fileId: `fb${++n}`, versionId: `v${n}` }),
      remove: async () => undefined,
    },
    docx: { toMarkdown: async () => ({ ok: true, markdown: "", warnings: [] }) },
    starter: { start: async () => undefined },
    zipNames: () => [],
    limits: { tenant: 100, global: 1000 },
    newId: () => Bun.randomUUIDv7(),
  });
  const tool = createFromStepTool({
    upload,
    // Kho tệp hub giả: chỉ tệp của công ty T1 (đúng như đọc theo `tenant_id`).
    readFile: async (tenantId, id) =>
      tenantId === T1 && id === FILE_T1 ? { name: "hd.pdf", bytes: PDF } : null,
    timeZoneOf: async () => "Asia/Ho_Chi_Minh",
    link: {
      recordOf: async (_t, runId) => attached.get(runId) ?? null,
      attach: async (_t, runId, cid) => {
        if (attached.has(runId)) return false;
        attached.set(runId, cid);
        return true;
      },
    },
  });
  return tool;
}
const ctx = (tenantId: string, userId: string) => ({
  tenantId,
  userId,
  runId: null,
  processRunId: RUN,
});
const count = async (t: string) =>
  Number(
    (await o`select count(*)::int as n from contracts.contracts where tenant_id = ${t}`)[0]?.n,
  );

describe("contracts-create-from-step", () => {
  it("tệp bước Soạn thảo → HĐ của công ty lượt → Ký số (selfsign) nhận đúng HĐ, công ty khác không thấy", async () => {
    const attached = new Map<string, string>();
    const tool = setup(attached);
    const r = (await tool.run(ctx(T1, A), {
      file_id: FILE_T1,
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
    expect(attached.get(RUN)).toBe(r.contract_id); // lượt gắn HĐ
    expect(await count(T2)).toBe(0); // cách ly công ty
    // thử lại cùng lượt ⇒ trả lại HĐ cũ, không tạo đôi
    const again = (await tool.run(ctx(T1, A), { file_id: FILE_T1 })) as {
      contract_id: string;
      status: string;
    };
    expect(again).toMatchObject({ status: "exists", contract_id: r.contract_id });
    expect(await count(T1)).toBe(1);

    // Ký số nhận contract_id từ đầu ra của bước tạo HĐ (khoá bản soạn rồi gửi ký)
    const u = esignModule(db, { esign: { providers: [selfsignProvider()] }, files });
    await u.saveSettings(
      { tenantId: T1, userId: A },
      { enabled: true, default_provider: "selfsign" },
    );
    const uow = createPackUow(db, "contracts", (tx: Tx, t: string) => ({
      extraction: extractionRepo(tx, t),
      esign: esignRepo(tx, t),
    }));
    const send = intakeTools({
      uow,
      send: u.sendSystem,
      nodeSigners: u.resolveNodeSigners,
      parsePartner: () => null,
    }).find((t) => t.name === "contracts-esign-send");
    await send?.run(ctx(T1, A), {
      contract_id: r.contract_id,
      company_signers: `user:${A}`,
      partner_signs: false,
    });
    const [e] =
      await o`select provider, status from contracts.esign_envelopes where contract_id = ${r.contract_id}`;
    expect(e?.provider).toBe("selfsign");
    const [locked] =
      await o`select locked_at is not null as l from contracts.contracts where id = ${r.contract_id}`;
    expect(locked?.l).toBe(true);
  });

  it("không có tệp / tệp công ty khác ⇒ CONTRACT_STEP_FILE_MISSING, không tạo gì", async () => {
    const tool = setup(new Map());
    await expect(tool.run(ctx(T1, A), { title: "x" })).rejects.toThrow(
      "CONTRACT_STEP_FILE_MISSING",
    );
    await expect(tool.run(ctx(T2, X), { file_id: FILE_T1 })).rejects.toThrow(
      "CONTRACT_STEP_FILE_MISSING",
    );
    expect(await count(T2)).toBe(0);
  });
});
