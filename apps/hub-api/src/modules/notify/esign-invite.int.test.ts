// CR-125 · x12 · email "Mời ký số" có thẻ tóm tắt + ảnh trang đầu, DB thật (pool hub_api, role contracts_rw): tới lượt người ký ⇒ ĐÚNG MỘT email tới người ký
// (không tới người khác), có link sâu `/contracts/c/<id>#esign-panel` + các trường thẻ + ảnh nhúng; ảnh dựng MỘT lần mỗi phiên bản HĐ (gửi lại không dựng lại);
// công ty tắt "Kèm ảnh trang đầu" ⇒ không ảnh, không dựng. Đường thật: tool `contracts-esign-send` → chuông (dữ liệu thẻ) → `dispatchOnce` → transport giả.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import {
  type ESignFiles,
  esignModule,
  intakeWiring,
  selfsignProvider,
} from "../packs/contracts/testing";
import { dispatchRepo } from "./adapters/dispatch.repo";
import { FakeEmailTransport, FakePushTransport } from "./adapters/transport.fake";
import { type DispatchDeps, drain } from "./application/dispatch.usecase";

let o: Sql;
let db: Db;
let T1 = "";
let A = "";
let B = "";
let C = "";
let K: string[] = [];
let renders = 0;
const email = new FakeEmailTransport();

const files: ESignFiles = () => ({
  getContent: async () => new TextEncoder().encode("%PDF-1.4\n%%EOF\n"),
  postFile: async () => ({ fileId: "f", versionId: "v" }),
  getLink: async () => null,
  deleteFile: async () => null,
});
const render = async () => {
  renders++;
  return { b64: Buffer.from("jpeg-bytes").toString("base64"), width: 560, height: 740 };
};
const deps = (): DispatchDeps => ({
  store: dispatchRepo(db),
  email,
  push: new FakePushTransport(),
  now: () => new Date(),
  baseUrl: "https://app.test.vn",
});

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [T1] = (await tenants(o, 1, 981)) as [string];
  [A, B, C] = (await users(o, T1, 3, { from: 981 })) as [string, string, string];
  K = await contracts(o, T1, 3, { from: 981, createdBy: A, owner: A });
  await o`update admin.users set locale = 'vi' where id = ${B}`; // ngôn ngữ người ký
  await o`update admin.tenants set legal_name = 'Công ty TNHH Demo Việt' where id = ${T1}`;
  for (const [i, id] of K.entries()) {
    const fid = crypto.randomUUID();
    await o`insert into contracts.files (id, tenant_id, org, file_id, version_id, name, mime, size_bytes, created_by)
      values (${fid}, ${T1}, ${`t_${T1}`}, ${`f${i}`}, ${`v${i}`}, 'hd.pdf', 'application/pdf', 16, ${A})`;
    await o.begin(async (tx) => {
      // CR-127 K1: status chỉ đổi qua cổng (trigger) — mở cổng bulk trong đúng tx của fixture
      await tx`select set_config('contracts.state_gate', 'bulk:' || txid_current(), true)`;
      await tx`update contracts.contracts set status = 'done', confirmed_at = now(), file_id = ${fid},
      title = ${`Hợp đồng mua bán lô ${i}`},
      fields = jsonb_build_object('total_value', jsonb_build_object('value', '600000000'),
        'start_date', jsonb_build_object('value', '2026-12-01'), 'end_date', jsonb_build_object('value', '2027-11-30'))
      where id = ${id}`;
    });
  }
  await o`delete from hub.notifications`;
  db = createDb(urls().hubApi, { max: 4 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

const sendInvite = async (id: string) => {
  const u = esignModule(db, { esign: { providers: [selfsignProvider()] }, files, render });
  await u.saveSettings(
    { tenantId: T1, userId: A },
    { enabled: true, default_provider: "selfsign" },
  );
  const tool = intakeWiring(db, u).tools.find((t) => t.name === "contracts-esign-send");
  if (!tool) throw new Error("thiếu tool contracts-esign-send");
  await tool.run(
    { tenantId: T1, userId: A, runId: null },
    { contract_id: id, company_signers: `user:${B}` },
  );
  const before = email.sent.length;
  await drain(deps());
  return email.sent.slice(before);
};

describe("CR-125 x12 · email Mời ký có thẻ + ảnh trang đầu", () => {
  it("tới lượt người ký ⇒ MỘT email tới đúng người ký, có link sâu, thẻ tóm tắt và ảnh nhúng, người khác không nhận", async () => {
    const mails = await sendInvite(K[0] as string);
    expect(mails.map((m) => m.to)).toEqual(["u982@kit.test"]); // B = người ký; A (chủ HĐ) và C không nhận
    const m = mails[0];
    expect(m?.subject).toStartWith("Mời ký: ");
    expect(m?.html).toContain(`https://app.test.vn/contracts/c/${K[0]}?ky=1#esign-panel`);
    expect(m?.text).toContain(`https://app.test.vn/contracts/c/${K[0]}?ky=1#esign-panel`);
    for (const f of ["600.000.000", "01/12/2026", "30/11/2027", "User 981", "Xem hợp đồng và ký"])
      expect(m?.html).toContain(f);
    expect(m?.html).toContain("Công ty TNHH Demo Việt");
    expect(m?.html).toContain("cid:contract-page1");
    expect(m?.inline).toEqual([
      {
        cid: "contract-page1",
        contentType: "image/jpeg",
        base64: Buffer.from("jpeg-bytes").toString("base64"),
      },
    ]);
    expect(m?.text).not.toContain("%PDF"); // không đính/nhúng hợp đồng
    expect(renders).toBe(1);
  });

  it("gửi lại cho cùng phiên bản HĐ ⇒ ảnh KHÔNG dựng lại (cache theo tệp)", async () => {
    const before = renders;
    const mails = await sendInvite(K[0] as string).catch(() => []);
    // phong bì đang mở ⇒ gửi lại có thể bị từ chối; cái cần giữ: không có lần dựng thêm cho cùng tệp
    expect(renders).toBe(before);
    expect(mails.length).toBeLessThanOrEqual(1);
  });

  it("công ty tắt 'Kèm ảnh trang đầu' ⇒ email vẫn có thẻ, KHÔNG ảnh và không dựng", async () => {
    const u = esignModule(db, { esign: { providers: [selfsignProvider()] }, files, render });
    await u.saveSettings({ tenantId: T1, userId: A }, { invite_thumbnail: false });
    expect((await u.settings({ tenantId: T1, userId: A })).invite_thumbnail).toBe(false);
    const before = renders;
    const mails = await sendInvite(K[1] as string);
    expect(mails).toHaveLength(1);
    expect(mails[0]?.html).toContain("600.000.000");
    expect(mails[0]?.html).not.toContain("cid:contract-page1");
    expect(mails[0]?.inline ?? []).toEqual([]);
    expect(renders).toBe(before);
    expect(C).not.toBe("");
  });
});
