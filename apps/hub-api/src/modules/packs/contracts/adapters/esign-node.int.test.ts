// CR-122 · E5 · node Ký số theo cấu hình riêng, DB thật (pool hub_api, role contracts_rw): `args` của stage tool GHI ĐÈ cài đặt ký số của
// app (nhà cung cấp, người ký công ty, thứ tự, đối tác ký); không có args ⇒ cài đặt app như trước. Người ký phải thuộc công ty (chặn
// chéo tenant); `GET /esign/options` + kiểm cấu hình khi lưu def. Nhà cung cấp GIẢ trong bộ nhớ (mượn khoá `misa` = loại "ca").
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ESignSignerSchema } from "@ai/contracts/pack-contracts";
import { createDb, type Db, type Tx } from "@ai/db";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createPackUow } from "../../kit/adapters/pack-uow";
import type { ESignFiles } from "../application/esign.ports";
import { esignModule } from "../esign.mount";
import { fakeESign } from "./esign.fake";
import { esignRepo } from "./esign.repo";
import { selfsignProvider } from "./esign.selfsign";
import { extractionRepo } from "./extraction.repo";
import { intakeTools } from "./intake.tools";

let o: Sql;
let db: Db;
let T1 = "";
let T2 = "";
let A = "";
let B = "";
let X = ""; // người dùng của T2
let K: string[] = [];

const files: ESignFiles = () => ({
  getContent: async () => new TextEncoder().encode("%PDF-1.4\n%%EOF\n"),
  postFile: async () => ({ fileId: "f", versionId: "v" }),
  getLink: async () => null,
  deleteFile: async () => null,
});

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [T1, T2] = (await tenants(o, 2, 961)) as [string, string];
  [A, B] = (await users(o, T1, 2, { from: 961 })) as [string, string];
  [X] = (await users(o, T2, 1, { from: 971 })) as [string];
  K = await contracts(o, T1, 3, { from: 961, createdBy: A, owner: A });
  for (const [i, id] of K.entries()) {
    const fid = crypto.randomUUID();
    await o`insert into contracts.files (id, tenant_id, org, file_id, version_id, name, mime, size_bytes, created_by)
      values (${fid}, ${T1}, ${`t_${T1}`}, ${`f${i}`}, ${`v${i}`}, 'hd.pdf', 'application/pdf', 16, ${A})`;
    await o`update contracts.contracts set status = 'active', confirmed_at = now(), file_id = ${fid}
      where id = ${id}`;
  }
  db = createDb(urls().hubApi, { max: 4 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

const misa = { ...fakeESign(), key: "misa" } as ReturnType<typeof fakeESign>;
const setup = () => {
  const u = esignModule(db, { esign: { providers: [selfsignProvider(), misa] }, files });
  const uow = createPackUow(db, "contracts", (tx: Tx, t: string) => ({
    extraction: extractionRepo(tx, t),
    esign: esignRepo(tx, t),
  }));
  const tools = intakeTools({
    uow,
    send: u.sendSystem,
    nodeSigners: u.resolveNodeSigners,
    parsePartner: (name, email) => {
      const p = ESignSignerSchema.safeParse({ role: "partner", name, email });
      return p.success && p.data.role === "partner"
        ? { name: p.data.name, email: p.data.email }
        : null;
    },
  });
  const send = tools.find((t) => t.name === "contracts-esign-send") as (typeof tools)[number];
  return { u, send };
};
const CTX = (userId: string) => ({ tenantId: T1, userId, runId: null });
const envelope = async (cid: string) =>
  (
    await o<
      {
        provider: string;
        signers: { role: string; order: number; client_user_id: string | null }[];
      }[]
    >`select provider, signers from contracts.esign_envelopes where contract_id = ${cid}`
  )[0];

describe("E5 · args của node ghi đè cài đặt ký số của app", () => {
  it("không args ⇒ nhà cung cấp mặc định + người bắt đầu, có args ⇒ nhà cung cấp, người ký, thứ tự theo node", async () => {
    const { u, send } = setup();
    await u.saveSettings(
      { tenantId: T1, userId: A },
      { enabled: true, default_provider: "selfsign" },
    );

    // (1) không cấu hình node ⇒ như trước: mặc định công ty (selfsign), người ký = người bắt đầu (A), tuần tự
    await send.run(CTX(A), { contract_id: K[0] as string });
    const base = await envelope(K[0] as string);
    expect(base?.provider).toBe("selfsign");
    expect(base?.signers).toMatchObject([{ role: "company", order: 1, client_user_id: A }]);

    // (2) args ghi đè: nhà cung cấp misa (khác mặc định), người ký công ty = B (không phải người bắt đầu A), song song
    await send.run(CTX(A), {
      contract_id: K[1] as string,
      provider: "misa",
      company_signers: `user:${B}`,
      partner_signs: false,
      order: "parallel",
    });
    const over = await envelope(K[1] as string);
    expect(over?.provider).toBe("misa");
    expect(over?.signers).toMatchObject([{ role: "company", order: 1, client_user_id: B }]);
  });

  it("người ký thuộc công ty khác / không tồn tại ⇒ từ chối, không tạo phong bì", async () => {
    const { u, send } = setup();
    await u.saveSettings(
      { tenantId: T1, userId: A },
      { enabled: true, default_provider: "selfsign" },
    );
    const id = K[2] as string;
    await expect(
      send.run(CTX(A), { contract_id: id, company_signers: `user:${X}` }),
    ).rejects.toThrow();
    await expect(
      send.run(CTX(A), { contract_id: id, company_signers: `group:${crypto.randomUUID()}` }),
    ).rejects.toThrow();
    expect(await envelope(id)).toBeUndefined();
  });

  it("GET options: chỉ nhà cung cấp đang bật + mặc định, kiểm cấu hình khi lưu def báo lỗi theo trường", async () => {
    const { u } = setup();
    await u.saveSettings(
      { tenantId: T1, userId: A },
      { enabled: true, default_provider: "selfsign" },
    );
    const opt = await u.nodeOptions({ tenantId: T1, userId: A });
    expect(opt.providers.map((p) => p.key).sort()).toEqual(["misa", "selfsign"]);
    expect(opt).toMatchObject({
      enabled: true,
      default_provider: "selfsign",
      orders: ["parallel", "sequential"],
    });
    expect(
      await u.checkNode(T1, { provider: "misa", company_signers: [{ kind: "user", id: B }] }),
    ).toEqual([]);
    expect(await u.checkNode(T1, { provider: "docusign" })).toEqual([
      { field: "provider", code: "PROVIDER_UNAVAILABLE" },
    ]);
    expect(await u.checkNode(T1, { company_signers: [{ kind: "user", id: X }] })).toEqual([
      { field: "company_signers", code: "SIGNER_NOT_IN_TENANT" },
    ]);
  });
});
