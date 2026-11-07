// CR-122 · E5 · node Ký số theo cấu hình riêng, DB thật (pool hub_api, role contracts_rw): `args` của stage tool GHI ĐÈ cài đặt ký số của
// app (nhà cung cấp, người ký công ty, thứ tự, đối tác ký); không có args ⇒ cài đặt app như trước. Người ký phải thuộc công ty (chặn
// chéo tenant); `GET /esign/options` + kiểm cấu hình khi lưu def. Nhà cung cấp GIẢ trong bộ nhớ (mượn khoá `misa` = loại "ca").
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ESignSignerSchema } from "@ai/contracts/pack-contracts";
import { createDb, type Db, type Tx } from "@ai/db";
import { contracts, groups, members, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createPackUow } from "../../kit/adapters/pack-uow";
import { nodeConfigRegistry } from "../../kit/public";
import type { ESignFiles } from "../application/esign.ports";
import { esignModule } from "../esign.mount";
import { intakeWiring } from "../intake.mount";
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
let C = "";
let D = "";
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
  [A, B, C, D] = (await users(o, T1, 4, { from: 961 })) as [string, string, string, string];
  [X] = (await users(o, T2, 1, { from: 971 })) as [string];
  K = await contracts(o, T1, 7, { from: 961, createdBy: A, owner: A });
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
  nodeConfigRegistry.clear("contracts-esign-send"); // validator đăng ký toàn cục dùng db đã đóng ⇒ không để rò sang file int khác cùng tiến trình
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
        due_h: number | null;
        remind_every_h: number | null;
      }[]
    >`select provider, signers, due_h, remind_every_h from contracts.esign_envelopes where contract_id = ${cid}`
  )[0];

describe("E5 · args của node ghi đè cài đặt ký số của app", () => {
  it("không args ⇒ nhà cung cấp mặc định + người bắt đầu, có args ⇒ nhà cung cấp, người ký, thứ tự theo node", async () => {
    const { u, send } = setup();
    await u.saveSettings(
      { tenantId: T1, userId: A },
      { enabled: true, default_provider: "selfsign" },
    );

    // (1) không cấu hình node ⇒ như trước: mặc định công ty (selfsign), người ký = người bắt đầu (A), tuần tự
    // CEO-review #2 · không chọn người ký công ty ⇒ lỗi nghiệp vụ, không tạo phong bì
    await expect(send.run(CTX(A), { contract_id: K[0] as string })).rejects.toThrow(
      "ESIGN_NODE_NO_SIGNER",
    );
    expect(await envelope(K[0] as string)).toBeUndefined();
    await send.run(CTX(A), { contract_id: K[0] as string, company_signers: `user:${A}` });
    const base = await envelope(K[0] as string);
    expect(base?.provider).toBe("selfsign");
    expect(base?.signers).toMatchObject([{ role: "company", order: 1, client_user_id: A }]);

    // (2) args ghi đè (kèm `provider` cũ ⇒ bỏ qua): người ký công ty = B (không phải người bắt đầu A), song song
    await send.run(CTX(A), {
      contract_id: K[1] as string,
      provider: "misa",
      company_signers: `user:${B}`,
      partner_signs: false,
      order: "parallel",
    });
    const over = await envelope(K[1] as string);
    expect(over?.provider).toBe("selfsign"); // CR-125 m4: `provider` cũ trong args bị bỏ qua — nhà cung cấp = mặc định công ty
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
    expect(await u.checkNode(T1, { company_signers: [{ kind: "user", id: B }] })).toEqual([]);
    expect(await u.checkNode(T1, { company_signers: [{ kind: "user", id: X }] })).toEqual([
      { field: "company_signers", code: "SIGNER_NOT_IN_TENANT" },
    ]);
  });
});

describe("E5b · danh bạ người ký: nhánh Group", () => {
  let G = ""; // Group của T1: B, C còn dùng được, D bị khoá
  let GX = ""; // Group của T2

  beforeAll(async () => {
    G = (await groups(o, T1, ["e5b-ky"])).get("e5b-ky") as string;
    await members(o, T1, G, [B, C, D]);
    await o`update admin.users set active = false where id = ${D}`;
    GX = (await groups(o, T2, ["e5b-khac"])).get("e5b-khac") as string;
    await members(o, T2, GX, [X]);
  });

  it("Group ⇒ mọi thành viên còn dùng được (bỏ người bị khoá), theo thứ tự khai, bỏ trùng", async () => {
    const { u } = setup();
    const members2 = [B, C].sort();
    expect(await u.resolveNodeSigners(T1, [{ kind: "group", id: G }])).toEqual(members2);
    // người cụ thể đứng trước Group khai sau; B trùng ⇒ giữ lần đầu
    expect(
      await u.resolveNodeSigners(T1, [
        { kind: "user", id: B },
        { kind: "group", id: G },
      ]),
    ).toEqual([B, ...members2.filter((x) => x !== B)]);
    expect(await u.checkNode(T1, { company_signers: [{ kind: "group", id: G }] })).toEqual([]);
  });

  it("Group của công ty khác ⇒ không thuộc công ty (kiểm lúc lưu + từ chối lúc gửi)", async () => {
    const { u, send } = setup();
    await u.saveSettings(
      { tenantId: T1, userId: A },
      { enabled: true, default_provider: "selfsign" },
    );
    expect(await u.checkNode(T1, { company_signers: [{ kind: "group", id: GX }] })).toEqual([
      { field: "company_signers", code: "SIGNER_NOT_IN_TENANT" },
    ]);
    await expect(
      send.run(CTX(A), { contract_id: K[3] as string, company_signers: `group:${GX}` }),
    ).rejects.toThrow();
    expect(await envelope(K[3] as string)).toBeUndefined();
  });

  it("gửi ký với Group ⇒ mỗi thành viên còn dùng được là một người ký công ty, hạn/nhắc ghi trên phong bì", async () => {
    const { u, send } = setup();
    await u.saveSettings(
      { tenantId: T1, userId: A },
      { enabled: true, default_provider: "selfsign" },
    );
    await send.run(CTX(A), {
      contract_id: K[3] as string,
      company_signers: `group:${G}`,
      partner_signs: false,
      order: "sequential",
      due_days: 3,
      remind_every_hours: 12,
    });
    const e = await envelope(K[3] as string);
    expect(e?.signers.map((s) => s.client_user_id)).toEqual([B, C].sort());
    expect(e?.signers.map((s) => s.order)).toEqual([1, 2]);
    expect([e?.due_h, e?.remind_every_h]).toEqual([72, 12]);
    // không cấu hình node ⇒ cột trống (sweep dùng bước Ký số cũ)
    await send.run(CTX(A), { contract_id: K[4] as string, company_signers: `user:${A}` });
    const base = await envelope(K[4] as string);
    expect([base?.due_h, base?.remind_every_h]).toEqual([null, null]);
  });
});

describe("CR-122 · bước Ký số của flow báo chuông người ký", () => {
  it("gửi qua intakeWiring (đường flow mới) ⇒ người ký công ty nhận chuông 'Mời ký số'", async () => {
    const { u } = setup();
    await u.saveSettings(
      { tenantId: T1, userId: A },
      { enabled: true, default_provider: "selfsign" },
    );
    const id = K[6] as string;
    await o`update contracts.contracts set status = 'needs_review', confirmed_at = null, locked_at = null,
        run_id = gen_random_uuid() where id = ${id}`;
    const w = intakeWiring(db, u);
    const send = w.tools.find((t) => t.name === "contracts-esign-send") as (typeof w.tools)[number];
    await send.run(CTX(A), { contract_id: id, company_signers: `user:${C}`, partner_signs: false });
    const bells = await o<{ title: string }[]>`select title from hub.notifications
      where tenant_id = ${T1} and user_id = ${C} and link = ${`/contracts/c/${id}`}`;
    expect(bells.map((b) => b.title)).toEqual([expect.stringMatching(/^Mời ký số HĐ/)]);
  });
});

describe("CR-122 · Ký số giữa flow: HĐ chưa xác nhận", () => {
  it("HĐ đang trong lượt duyệt ⇒ bước Ký số khoá HĐ rồi gửi; bản cũ chỉ bị thay khi xác nhận", async () => {
    const { u, send } = setup();
    await u.saveSettings(
      { tenantId: T1, userId: A },
      { enabled: true, default_provider: "selfsign" },
    );
    const [v1, v2] = [K[2] as string, K[5] as string];
    // v2 của chuỗi v1, đang chờ duyệt (needs_review + run_id), chưa khoá — như sau "Xác nhận và lưu" của flow mới
    await o`update contracts.contracts set status = 'needs_review', confirmed_at = null, locked_at = null,
        run_id = gen_random_uuid(), root_id = ${v1}, version_no = 2, supersedes_id = ${v1}
      where id = ${v2}`;
    await send.run(CTX(B), { contract_id: v2, company_signers: `user:${B}` });
    expect((await envelope(v2))?.provider).toBe("selfsign");
    const st = async (id: string) =>
      (
        await o<{ status: string; locked_by: string | null; superseded_at: Date | null }[]>`
          select status, locked_by, superseded_at from contracts.contracts where id = ${id}`
      )[0];
    expect(await st(v2)).toMatchObject({ status: "needs_review", locked_by: B });
    expect((await st(v1))?.superseded_at).toBeNull(); // khoá sớm KHÔNG thay bản cũ
    // chạy lại (Thử lại của bước) ⇒ không đổi người khoá
    await o`update contracts.esign_envelopes set status = 'voided' where contract_id = ${v2}`;
    await send.run(CTX(A), { contract_id: v2, company_signers: `user:${A}` });
    expect((await st(v2))?.locked_by).toBe(B);
    // "Kết thúc · Đã duyệt" xác nhận ⇒ lúc này mới thay bản cũ
    await o`update contracts.contracts set status = 'active', confirmed_at = now() where id = ${v2}`;
    expect((await st(v1))?.superseded_at).not.toBeNull();
  });
});
