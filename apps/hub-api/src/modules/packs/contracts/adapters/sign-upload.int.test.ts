// CR-141 · bước «Ký hợp đồng» — tải bản đã ký (DB thật, role gói `contracts_rw` + RLS): người được giao (khác người tạo HĐ) tải ⇒ HĐ có bản «Đã ký»
// (cùng chỗ bản ký số), có dòng lịch sử, thả bước; người không được giao bị chặn; Toàn quyền duyệt thay (ghi rõ); công ty khác ⇒ 404.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../../lib/db";
import { createPackUow } from "../../kit/adapters/pack-uow";
import type { PackUow } from "../../kit/public";
import { type SignUploadFail, signUploadUsecase } from "../application/sign-upload.usecase";
import { esignModule } from "../esign.mount";
import { selfsignProvider } from "./esign.selfsign";
import { signUploadRepo } from "./sign-upload.repo";

let o: Sql;
let db: Db;
let T = "";
let T2 = "";
let U1 = ""; // người tạo HĐ
let U2 = ""; // người ký được giao
let U3 = ""; // công ty khác
let seq = 0;
const removed: string[] = [];
const after: { id: string; data: Record<string, string> }[] = [];

const uc = () =>
  signUploadUsecase({
    uow: createPackUow(db, "contracts", (tx, t) => ({
      signUpload: signUploadRepo(tx, t),
    })) as never as PackUow<{ signUpload: ReturnType<typeof signUploadRepo> }>,
    files: {
      put: async () => ({ fileId: `fb-${++seq}`, versionId: `v-${seq}` }),
      remove: async (_org, id) => void removed.push(id),
    },
    me: async () => ({ name: "Người ký" }),
    newId: () => Bun.randomUUIDv7(),
    voidOpen: async () => {},
    after: async (_w, id, data) => void after.push({ id, data }),
  });
const w = (userId: string, tenantId = T) => ({ tenantId, userId });
const pdf = (name = "hd-da-ky.pdf") => ({ name, bytes: new Uint8Array([37, 80, 68, 70, 45]) });
const png = (name = "scan.png") => ({ name, bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]) });
const fail = async (p: Promise<unknown>) =>
  ((await p.catch((x: unknown) => x)) as SignUploadFail).kind;

async function mk(assigned: string[] | null): Promise<string> {
  const [r] = await o<{ id: string }[]>`insert into contracts.contracts ${o({
    tenant_id: T,
    title: "HĐ CR141",
    created_by: U1,
    status: "draft",
  } as never)} returning id`;
  const id = (r as { id: string }).id;
  if (assigned)
    await o`insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
      values (${T}::uuid, ${id}::uuid, 'sign_upload_open', ${U1}::uuid, ${o.json({ signers: assigned } as never)})`;
  return id;
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  [T, T2] = (await tenants(o, 2, 9341)) as [string, string];
  [U1, U2] = (await users(o, T, 2, { from: 9341 })) as [string, string];
  [U3] = (await users(o, T2, 1, { from: 9343 })) as [string];
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-141 · tải bản đã ký", () => {
  it("đường chính: người ký được giao (khác người tạo) tải ⇒ phong bì «upload» đã ký + tệp + dòng lịch sử + thả bước, tải lần hai bị chặn", async () => {
    const id = await mk([U2]);
    expect(await uc().state(w(U2), id, false)).toEqual({
      awaiting: true,
      can_upload: true,
      override: false,
    });
    const out = await uc().upload(w(U2), id, pdf(), false);
    expect(out.override).toBe(false);
    const [e] = await o`select e.provider, e.status, e.signed_file_id, f.name, f.mime, f.created_by
      from contracts.esign_envelopes e join contracts.files f on f.id = e.signed_file_id
      where e.contract_id = ${id}::uuid`;
    expect(e).toMatchObject({
      provider: "upload",
      status: "completed",
      name: "hd-da-ky.pdf",
      mime: "application/pdf",
      created_by: U2,
    });
    const [ev] = await o`select actor_user_id, data from contracts.contract_events
      where contract_id = ${id}::uuid and type = 'esign_uploaded'`;
    expect(ev?.actor_user_id).toBe(U2);
    expect(ev?.data).toMatchObject({ file_name: "hd-da-ky.pdf", override: false });
    expect(after.find((a) => a.id === id)?.data.signer).toBe("Người ký");
    expect((await uc().state(w(U2), id, false)).awaiting).toBe(false);
    expect(await fail(uc().upload(w(U2), id, pdf(), false))).toBe("not_awaiting");
  });

  it("người không được giao (kể cả người tạo HĐ) bị chặn, không ghi gì, Toàn quyền duyệt thay và ghi rõ", async () => {
    const id = await mk([U2]);
    expect(await uc().state(w(U1), id, false)).toMatchObject({ awaiting: true, can_upload: false });
    expect(await fail(uc().upload(w(U1), id, pdf(), false))).toBe("forbidden");
    const [n] =
      await o`select count(*)::int as n from contracts.esign_envelopes where contract_id = ${id}::uuid`;
    expect(n?.n).toBe(0);
    const out = await uc().upload(w(U1), id, png(), true);
    expect(out.override).toBe(true);
    const [ev] =
      await o`select data from contracts.contract_events where contract_id = ${id}::uuid and type = 'esign_uploaded'`;
    expect(ev?.data).toMatchObject({ file_name: "scan.png", override: true });
  });

  it("định dạng lạ ⇒ file_type, bước chưa mở chờ ⇒ not_awaiting", async () => {
    const id = await mk([U2]);
    expect(
      await fail(uc().upload(w(U2), id, { name: "hd.docx", bytes: new Uint8Array([1]) }, false)),
    ).toBe("file_type");
    const idle = await mk(null);
    expect(await fail(uc().upload(w(U2), idle, pdf(), true))).toBe("not_awaiting");
  });

  it("tệp đổi đuôi (nội dung không phải PDF/JPG/PNG) ⇒ file_content, không ghi gì", async () => {
    const id = await mk([U2]);
    expect(
      await fail(
        uc().upload(w(U2), id, { name: "hd.pdf", bytes: new Uint8Array([80, 75, 3, 4]) }, false),
      ),
    ).toBe("file_content");
    const [n] =
      await o`select count(*)::int as n from contracts.esign_envelopes where contract_id = ${id}::uuid`;
    expect(n?.n).toBe(0);
  });

  it("hai lần tải song song ⇒ đúng 1 phong bì, 1 lần thả bước", async () => {
    const id = await mk([U2]);
    after.length = 0;
    const r = await Promise.allSettled([
      uc().upload(w(U2), id, pdf("a.pdf"), false),
      uc().upload(w(U2), id, pdf("b.pdf"), false),
    ]);
    expect(r.filter((x) => x.status === "fulfilled").length).toBe(1);
    const [n] =
      await o`select count(*)::int as n from contracts.esign_envelopes where contract_id = ${id}::uuid and provider = 'upload'`;
    expect(n?.n).toBe(1);
    expect(after.filter((a) => a.id === id).length).toBe(1);
  });

  it("chéo công ty ⇒ không thấy HĐ (not_found), không ghi gì", async () => {
    const id = await mk([U2]);
    expect(await fail(uc().upload(w(U3, T2), id, pdf(), true))).toBe("not_found");
    expect(await fail(uc().state(w(U3, T2), id, true))).toBe("not_found");
    const [n] =
      await o`select count(*)::int as n from contracts.esign_envelopes where contract_id = ${id}::uuid`;
    expect(n?.n).toBe(0);
  });
});

describe("CR-141 · phong bì ký số đang mở", () => {
  it("tải bản ký ⇒ phong bì cũ bị huỷ, bước qua đúng 1 lần (không bắn completed lần hai)", async () => {
    const files = () => ({
      postFile: async () => ({ fileId: `fb-${++seq}`, versionId: "v" }),
      deleteFile: async () => undefined,
      getContent: async () => null,
      getLink: async () => null,
    });
    const m = esignModule(db, { esign: { providers: [selfsignProvider()] }, files });
    const fired: string[] = [];
    m.bindCompleted(async (_t, _c, ev) => void fired.push(ev));
    const id = await mk([U2]);
    await o`insert into contracts.esign_envelopes (tenant_id, contract_id, provider, envelope_id, status, signers, sent_by)
      values (${T}::uuid, ${id}::uuid, 'selfsign', ${`env-${id}`}, 'sent',
        ${o.json([{ role: "company", name: "Người ký", client_user_id: U2 }] as never)}, ${U1}::uuid)`;
    await m.signUpload?.upload(w(U2), id, pdf(), false);
    const rows =
      await o`select provider, status from contracts.esign_envelopes where contract_id = ${id}::uuid order by created_at, provider`;
    expect(Object.fromEntries(rows.map((x) => [x.provider, x.status]))).toEqual({
      selfsign: "voided",
      upload: "completed",
    });
    expect(fired).toEqual(["esign.completed"]);
  });
});
