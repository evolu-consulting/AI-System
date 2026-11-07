// CR-124 · q7 · tool `contracts-partner-send` từ chối TRƯỚC KHI ghi gì khi (1) kênh hộp thư tắt trên hệ thống (`HUB_PARTNER_MAILBOX=off`),
// (2) công ty chưa bật tính năng `contracts-partner-confirm`: lỗi nghiệp vụ có mã (thẻ nói rõ vì sao), KHÔNG hàng mailbox / lần gửi / lời mời nối mồ côi.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createPackUow } from "../kit/adapters/pack-uow";
import { PackToolBusinessError, type PackToolCtx } from "../kit/public";
import { esignRepo } from "./adapters/esign.repo";
import { partnerSendRepo } from "./adapters/partner-send.repo";
import { type PartnerToolDeps, partnerSendTool } from "./adapters/partner-send.tool";

let o: Sql;
let db: Db;
let A = "";
let UA = "";
let C: string[] = [];

const uow = () =>
  createPackUow(db, "contracts", (tx, t) => ({
    partnerSend: partnerSendRepo(tx, t),
    esign: esignRepo(tx, t),
  }));
const run = (extra: Partial<PartnerToolDeps>, id: string) =>
  partnerSendTool({ uow: uow(), ...extra }).run(
    { tenantId: A, userId: UA, runId: null, processRunId: null } as PackToolCtx,
    { contract_id: id, send_fields: "total_value", partner_tax_code: "0101234569" },
  );
const rows = async () => ({
  mailbox: (await o`select 1 from hub.partner_mailbox where from_tenant = ${A}`).length,
  sends: (await o`select 1 from contracts.partner_sends where tenant_id = ${A}`).length,
  links: (await o`select 1 from hub.partner_links where from_tenant = ${A}`).length,
});

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  const [a, b] = (await tenants(o, 2, 1340)) as [string, string];
  A = a;
  [UA] = (await users(o, A, 1, { from: 1340 })) as [string];
  await o`update admin.tenants set legal_name = 'Công ty A', tax_code = '0109999997' where id = ${A}`;
  await o`update admin.tenants set legal_name = 'Công ty B', tax_code = '0101234569', directory_listed = true where id = ${b}`;
  C = await contracts(o, A, 3, { from: 1340, createdBy: UA, status: "active" });
  for (const [i, id] of C.entries()) {
    const fid = crypto.randomUUID();
    await o`insert into contracts.files (id, tenant_id, org, file_id, version_id, name, mime, size_bytes, created_by)
      values (${fid}, ${A}, ${`t_${A}`}, ${`f${i}`}, ${`v${i}`}, 'hd.pdf', 'application/pdf', 16, ${UA})`;
    await o`update contracts.contracts set file_id = ${fid}, direction = 'sale', fields = ${o.json({
      buyer_name: { value: "Đối tác" },
      total_value: { value: 1000 },
    } as never)} where id = ${id}`;
  }
  db = createDb(urls().hubApi, { max: 4 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

const reject = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as PackToolBusinessError;
  }
  throw new Error("tool phải từ chối");
};

describe("CR-124 q7 · tool Gửi đối tác chặn trước khi ghi", () => {
  it("kênh hộp thư TẮT trên hệ thống ⇒ PARTNER_CHANNEL_OFF (lỗi nghiệp vụ có mã), không ghi hàng nào", async () => {
    const e = await reject(run({ channelOn: false }, C[0] as string));
    expect(e).toBeInstanceOf(PackToolBusinessError);
    expect(e.code).toBe("PARTNER_CHANNEL_OFF");
    expect(await rows()).toEqual({ mailbox: 0, sends: 0, links: 0 });
  });

  it("công ty chưa bật tính năng ⇒ PARTNER_FEATURE_OFF, không ghi hàng nào", async () => {
    const e = await reject(run({ channelOn: true, featureOn: async () => false }, C[1] as string));
    expect(e).toBeInstanceOf(PackToolBusinessError);
    expect(e.code).toBe("PARTNER_FEATURE_OFF");
    expect(await rows()).toEqual({ mailbox: 0, sends: 0, links: 0 });
  });

  it("kênh bật + tính năng bật ⇒ gửi bình thường (đối chứng)", async () => {
    const r = await run({ channelOn: true, featureOn: async () => true }, C[2] as string);
    expect(r).toMatchObject({ round: 1 });
    expect((await rows()).mailbox).toBe(1);
  });
});
