// CR-130 pha 2 · L2 · ADR-0043 · `PartnerLinker` + hàm cổng `contracts.community_link_partner` / `community_partners` (DB thật).
// Chặn: user ngoài (kind=external ⇒ ném; viewer đối tác ⇒ 42501), không tự gắn vào đối tác SHT trùng tên (soát L2: mạo danh), party_key do
// Admin chọn tường minh (đã gắn tài khoản khác ⇒ already_linked; không có ⇒ not_found), công ty không thuộc tenant ⇒ org_forbidden,
// không đọc/ghi chéo tenant, idempotent, hoàn tác chung với tx duyệt. Không dùng cast khoá — tự dựng 2 tenant + công ty đối tác.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { withPackScope } from "@ai/db/pack-scope";
import { tenants } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { sql as dsql } from "drizzle-orm";
import { partnerLinker } from "./partner-linker";

let owner: Sql;
let db: Db;
let A = "";
let B = "";
const O = (n: number) => `7e5d00d1-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const [ORG1, ORG2, ORG3, ORG4] = [O(1), O(2), O(3), O(4)];
const ORG_B = O(50);
const ORG_RB = O(60);
const linker = partnerLinker();
type Tx = Parameters<Parameters<typeof withPackScope>[2]>[0];

beforeAll(async () => {
  await cloneDb("full");
  owner = openOwner(2);
  [A, B] = (await tenants(owner, 2, 77)) as [string, string];
  await owner`insert into admin.external_orgs (id, tenant_id, name)
    select x.id, x.t::uuid, x.n from jsonb_to_recordset(${owner.json([
      { id: ORG1, t: A, n: "Công ty Bao Bì Một" },
      { id: ORG2, t: A, n: "Hãng Mới" },
      { id: ORG3, t: A, n: "Hãng Ba" },
      { id: ORG4, t: A, n: "Hãng Bốn" },
      { id: ORG_RB, t: A, n: "Công ty Rollback" },
      { id: ORG_B, t: B, n: "Công ty B" },
    ])}) as x(id uuid, t text, n text)`;
  db = createDb(urls().hubApi, { max: 2 });
}, 120_000);
afterAll(async () => {
  await db?.close();
  await owner?.end({ timeout: 2 });
});

const asCommunity = <T>(tenant: string, fn: (tx: Tx) => Promise<T>) =>
  withPackScope(db, { packKey: "community", tenantId: tenant, userId: null }, fn);
const link = (tenant: string, i: Parameters<typeof linker.linkInTx>[2]) =>
  asCommunity(tenant, (tx) => linker.linkInTx(tx, { tenantId: tenant, kind: "internal" }, i));
const kindOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { kind?: string }) => e.kind ?? "ERR",
  );

describe("PartnerLinker.linkInTx [CR-130]", () => {
  it("trùng tên đối tác SHT ⇒ KHÔNG gắn vào đối tác có sẵn: tạo khoá mới (không mạo danh)", async () => {
    await owner`insert into contracts.partner_roles (tenant_id, party_key, role, name, created_from)
      values (${A}, 'tax:0101', 'customer', 'Công ty Bao Bì Một', 'manual'),
        (${A}, 'name:cong ty bao bi mot', 'customer', 'Công ty Bao Bì Một', 'manual')`;
    const r = await link(A, { extOrgId: ORG1, name: "CÔNG TY BAO BÌ MỘT", roles: ["supplier"] });
    expect(r.partyKey).toBe(`name:cong ty bao bi mot|${ORG1}`); // khoá `name:<fold>` đã có ở SHT ⇒ hậu tố org, không dùng lại
    const real = await owner`select count(*)::int as n from contracts.partner_profiles
      where party_key in ('tax:0101', 'name:cong ty bao bi mot')`;
    expect(real[0]?.n).toBe(0); // đối tác thật không bị gắn tài khoản
    const again = await link(A, { extOrgId: ORG1, name: "Tên khác", roles: ["supplier"] });
    expect(again.partyKey).toBe(r.partyKey); // idempotent: tài khoản đã có hồ sơ ⇒ giữ khoá
  });

  it("party_key do Admin chọn: gắn vào đối tác đó, vai chỉ thêm, giữ tên SHT; gọi lại idempotent", async () => {
    const r = await link(A, {
      extOrgId: ORG2,
      name: "Chữ do công ty ngoài gõ",
      roles: ["supplier"],
      partyKey: "tax:0101",
    });
    expect(r).toEqual({ partyKey: "tax:0101", linked: true });
    const rows =
      await owner`select role, name from contracts.partner_roles where party_key = 'tax:0101' order by role`;
    expect(rows.map((x) => x.role)).toEqual(["customer", "supplier"]);
    expect(rows.map((x) => x.name)).toEqual(["Công ty Bao Bì Một", "Công ty Bao Bì Một"]);
    expect(
      await link(A, { extOrgId: ORG2, name: "x", roles: ["supplier"], partyKey: "tax:0101" }),
    ).toEqual(r);
    // tài khoản đã gắn một đối tác ⇒ không chuyển sang đối tác khác
    expect(
      await kindOf(
        link(A, {
          extOrgId: ORG2,
          name: "x",
          roles: ["supplier"],
          partyKey: "name:cong ty bao bi mot",
        }),
      ),
    ).toBe("already_linked");
  });

  it("party_key đã gắn tài khoản khác ⇒ already_linked; không có đối tác ⇒ not_found", async () => {
    expect(
      await kindOf(
        link(A, { extOrgId: ORG3, name: "Hãng Ba", roles: ["customer"], partyKey: "tax:0101" }),
      ),
    ).toBe("already_linked");
    expect(
      await kindOf(
        link(A, { extOrgId: ORG3, name: "Hãng Ba", roles: ["customer"], partyKey: "tax:khong-co" }),
      ),
    ).toBe("not_found");
    const n =
      await owner`select count(*)::int as n from contracts.partner_profiles where ext_org_id = ${ORG3}`;
    expect(n[0]?.n).toBe(0);
  });

  it("p_org thuộc tenant khác ⇒ org_forbidden, không ghi gì", async () => {
    expect(await kindOf(link(A, { extOrgId: ORG_B, name: "Công ty B", roles: ["supplier"] }))).toBe(
      "org_forbidden",
    );
    const n =
      await owner`select count(*)::int as n from contracts.partner_profiles where ext_org_id = ${ORG_B}`;
    expect(n[0]?.n).toBe(0);
  });

  it("đối tác mới (chưa trùng) ⇒ khoá name:<fold>", async () => {
    const r = await link(A, { extOrgId: ORG4, name: "Hãng Bốn", roles: ["customer"] });
    expect(r).toEqual({ partyKey: "name:hang bon", linked: true });
  });

  it("chặn user ngoài: kind=external ⇒ ném; viewer là đối tác ở DB ⇒ 42501", async () => {
    await expect(
      asCommunity(A, (tx) =>
        linker.linkInTx(
          tx,
          { tenantId: A, kind: "external" },
          { extOrgId: ORG1, name: "X", roles: ["supplier"] },
        ),
      ),
    ).rejects.toThrow(/user ngoài/);
    // viewer đối tác: `packs.viewer_ext_org()` ≠ NULL ⇒ hàm cổng từ chối dù TS bị gọi sai (lỗi làm tx hỏng ⇒ bắt ở ngoài tx)
    const code = await withPackScope(
      db,
      { packKey: "community", tenantId: A, userId: O(99) },
      async (tx) => {
        await tx.execute(
          dsql`select set_config('app.user_kind', 'external', true), set_config('app.ext_org_id', ${ORG1}, true)`,
        );
        await tx.execute(
          dsql`select * from contracts.community_link_partner(${ORG3}::uuid, 'Y', array['supplier'], null)`,
        );
        return null;
      },
    ).catch((e: { cause?: { code?: string } }) => e.cause?.code ?? "ERR");
    expect(code).toBe("42501");
  });

  it("cách ly tenant: ghi dưới B không chạm A; community_partners dưới B không trả hàng A dù truyền org của A", async () => {
    await link(B, { extOrgId: ORG_B, name: "Công ty B", roles: ["supplier"] });
    const underB = await asCommunity(B, (tx) =>
      tx.execute<{ ext_org_id: string }>(
        dsql`select ext_org_id::text from contracts.community_partners(array[${ORG1}::uuid, ${ORG2}::uuid, ${ORG_B}::uuid])`,
      ),
    );
    expect([...underB].map((r) => r.ext_org_id)).toEqual([ORG_B]);
    const aRows =
      await owner`select count(*)::int as n from contracts.partner_profiles where tenant_id = ${A}`;
    expect(aRows[0]?.n).toBe(3); // ORG1, ORG2, ORG4
  });

  it("hoàn tác chung: tx duyệt ném ⇒ không còn hồ sơ vừa liên kết", async () => {
    await expect(
      asCommunity(A, async (tx) => {
        await linker.linkInTx(
          tx,
          { tenantId: A, kind: "internal" },
          { extOrgId: ORG_RB, name: "Công ty Rollback", roles: ["supplier"] },
        );
        throw new Error("duyệt lỗi");
      }),
    ).rejects.toThrow("duyệt lỗi");
    const n =
      await owner`select count(*)::int as n from contracts.partner_profiles where ext_org_id = ${ORG_RB}`;
    expect(n[0]?.n).toBe(0);
  });
});
