// CR-181 · s8 phần A — chuẩn bị chỗ ký (DB thật, role gói `contracts_rw` + RLS): BR-T1/C1/C2/T3 + phiên ký (chế độ prep|sign|view).
// Người được giao (U2) KHÔNG phải người tạo/tải lên; khác công ty (U3) thấy 404. Cổng lượt ký dùng cài đặt giả.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { PDFDocument } from "pdf-lib";
import { connectDb, type Db } from "../../../../lib/db";
import { createPackUow } from "../../kit/adapters/pack-uow";
import {
  type CompanySigner,
  type SignDocFail,
  type SignDocRepos,
  signDocUsecases,
} from "../application/sign-doc.usecase";
import type { SignTurnPort } from "../domain/sign-turn.port";
import { contractFilesRepo } from "./contract-files.repo";
import { signDocRepo } from "./sign-doc.repo";
import { signDocsRepo } from "./sign-docs.repo";
import { signFieldsRepo } from "./sign-fields.repo";
import { probePdf } from "./sign-pdf-probe";
import { signVersionsRepo } from "./sign-versions.repo";

let o: Sql;
let db: Db;
let T = "";
let T2 = "";
let U1 = ""; // người tạo HĐ + người tải lên tệp chính
let U2 = ""; // người được giao, không phải người tạo
let U3 = ""; // công ty khác
const GROUP = "4c1d0000-0000-4000-8000-000000000001";
let enabled = true;
let turnFor: string | null = null;
const boxes = new Map<string, Uint8Array>();
const part = (page: number) => ({
  page,
  x: 10,
  y: 10,
  w: 120,
  h: 50,
  cx: 10,
  cy: 10,
  cw: 120,
  ch: 50,
});

const uow = () =>
  createPackUow(db, "contracts", (tx, t) => ({
    contractFiles: contractFilesRepo(tx, t),
    signDoc: signDocRepo(tx, t),
    docs: signDocsRepo(tx, t),
    fields: signFieldsRepo(tx, t),
    versions: signVersionsRepo(tx, t),
  })) as never as import("../../kit/public").PackUow<SignDocRepos>;
const turn: SignTurnPort = {
  turnFor: async (_c, _id, user) =>
    user === turnFor ? { allowed: true, step: "sign", run_id: "r1" } : { allowed: false },
};
const company = (): CompanySigner[] => [
  { kind: "user", id: U1, name: "An" },
  { kind: "user", id: U2, name: "Bình" },
  { kind: "group", id: GROUP, name: "Ban giám đốc", mine: false },
];
const uc = () =>
  signDocUsecases({
    uow: uow(),
    files: { read: async (_org, boxId) => boxes.get(boxId) ?? null },
    maxBytes: 10_000_000,
    probePdf,
    companySigners: async () => company(),
    onDocEnabled: async () => enabled,
    turn,
    newId: () => Bun.randomUUIDv7(),
  });
const w = (userId: string, tenantId = T) => ({ tenantId, userId });
const fail = async (p: Promise<unknown>) => {
  const e = (await p.catch((x: unknown) => x)) as SignDocFail;
  return e.code ? `${e.kind}:${e.code}` : e.kind;
};

async function pdf(pages: number): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([595, 842]);
  return d.save();
}
async function mkFile(name: string, mime: string, bytes: Uint8Array, by = U1, tenant = T) {
  const boxId = `fb-${Bun.randomUUIDv7()}`;
  boxes.set(boxId, bytes);
  const [r] = await o<{ id: string }[]>`insert into contracts.files ${o({
    tenant_id: tenant,
    org: `t_${tenant}`,
    file_id: boxId,
    name,
    mime,
    size_bytes: bytes.byteLength,
    created_by: by,
  } as never)} returning id`;
  return (r as { id: string }).id;
}
async function mkContract(mainFile: string | null): Promise<string> {
  const [r] = await o<{ id: string }[]>`insert into contracts.contracts ${o({
    tenant_id: T,
    title: "HĐ CR181 s8",
    created_by: U1,
    status: "draft",
    ...(mainFile ? { file_id: mainFile } : {}),
  } as never)} returning id`;
  return (r as { id: string }).id;
}
async function attach(contractId: string, fileId: string, by: string) {
  await o`insert into contracts.contract_files (tenant_id, contract_id, file_id, added_by) values (${T}, ${contractId}, ${fileId}, ${by})`;
}
const setStatus = (id: string, status: string) =>
  o.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`update contracts.contracts set status = ${status} where id = ${id}`;
  });

type Fx = { id: string; main: string; word: string; big: string; extra: string };
async function fixture(): Promise<Fx> {
  const main = await mkFile("hop-dong.pdf", "application/pdf", await pdf(3));
  const id = await mkContract(main);
  const word = await mkFile("phu-luc.docx", "application/msword", new Uint8Array([1, 2, 3]));
  const big = await mkFile("dai.pdf", "application/pdf", await pdf(51));
  const extra = await mkFile("bien-ban.pdf", "application/pdf", await pdf(2), U2);
  await attach(id, word, U1);
  await attach(id, big, U1);
  await attach(id, extra, U2); // tệp kèm do người được giao (U2) tải lên
  return { id, main, word, big, extra };
}
const f1 = (kind: "user" | "group" | "partner", ref: string, side: "A" | "B" = "A", page = 0) => ({
  side,
  signer_kind: kind,
  signer_ref: ref,
  parts: [part(page)],
});

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  [T, T2] = (await tenants(o, 2, 9811)) as [string, string];
  [U1, U2] = (await users(o, T, 2, { from: 9811 })) as [string, string];
  [U3] = (await users(o, T2, 1, { from: 9813 })) as [string];
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-181 s8 · BR-T1/T3 bật «Cần ký»", () => {
  it("T1: người được giao / không phải người tải lên ⇒ forbidden, tệp kèm của U2 thì CHỈ U2 (người tạo HĐ cũng không)", async () => {
    const x = await fixture();
    expect(await fail(uc().setNeedsSign(w(U2), x.id, x.main, true))).toBe("forbidden");
    expect(await fail(uc().setNeedsSign(w(U1), x.id, x.extra, true))).toBe("forbidden");
    const ok = await uc().setNeedsSign(w(U2), x.id, x.extra, true);
    expect(ok).toEqual({ file_id: x.extra, needs_sign: true, pages: 2 });
  });
  it("PDF 3 trang bật được, số trang lưu, Word ⇒ SIGN_NOT_PDF, 51 trang ⇒ SIGN_TOO_MANY_PAGES, tệp lạ ⇒ not_found", async () => {
    const x = await fixture();
    expect(await uc().setNeedsSign(w(U1), x.id, x.main, true)).toEqual({
      file_id: x.main,
      needs_sign: true,
      pages: 3,
    });
    expect(await fail(uc().setNeedsSign(w(U1), x.id, x.word, true))).toBe("issue:SIGN_NOT_PDF");
    expect(await fail(uc().setNeedsSign(w(U1), x.id, x.big, true))).toBe(
      "issue:SIGN_TOO_MANY_PAGES",
    );
    expect(await fail(uc().setNeedsSign(w(U1), x.id, Bun.randomUUIDv7(), true))).toBe("not_found");
  });
  it("HĐ đang duyệt ⇒ locked (409 CONTRACT_NOT_DRAFT), công ty tắt ⇒ off (409 SIGN_ON_DOC_OFF)", async () => {
    const x = await fixture();
    enabled = false;
    expect(await fail(uc().setNeedsSign(w(U1), x.id, x.main, true))).toBe("off");
    enabled = true;
    await setStatus(x.id, "processing");
    expect(await fail(uc().setNeedsSign(w(U1), x.id, x.main, true))).toBe("locked");
  });
  it("khác công ty ⇒ not_found (không lộ tồn tại)", async () => {
    const x = await fixture();
    expect(await fail(uc().setNeedsSign(w(U3, T2), x.id, x.main, true))).toBe("not_found");
    expect(await fail(uc().putFields(w(U3, T2), x.id, x.main, []))).toBe("not_found");
  });
  it("tắt «Cần ký» ⇒ xoá chỗ ký chưa ký của tệp đó", async () => {
    const x = await fixture();
    await uc().setNeedsSign(w(U1), x.id, x.main, true);
    await uc().putFields(w(U1), x.id, x.main, [f1("user", U1), f1("user", U2)]);
    expect((await o`select 1 from contracts.sign_fields where contract_id = ${x.id}`).length).toBe(
      2,
    );
    await uc().setNeedsSign(w(U1), x.id, x.main, false);
    expect((await o`select 1 from contracts.sign_fields where contract_id = ${x.id}`).length).toBe(
      0,
    );
  });
});

describe("CR-181 s8 · BR-C1/C2 chỗ ký", () => {
  it("C2: người khác (kể cả quản trị gói) ⇒ forbidden, C1: người ký lạ / trang ngoài tệp ⇒ 422", async () => {
    const x = await fixture();
    await uc().setNeedsSign(w(U1), x.id, x.main, true);
    expect(await fail(uc().putFields(w(U2), x.id, x.main, [f1("user", U1)]))).toBe("forbidden");
    expect(await fail(uc().putFields(w(U1), x.id, x.main, [f1("user", U3)]))).toBe(
      "issue:SIGN_SIGNER_UNKNOWN",
    );
    expect(await fail(uc().putFields(w(U1), x.id, x.main, [f1("user", U1, "A", 3)]))).toBe(
      "issue:SIGN_PAGE_NOT_FOUND",
    );
    expect(await fail(uc().putFields(w(U1), x.id, x.main, [f1("partner", "x@y.vn", "B")]))).toBe(
      "issue:SIGN_SIGNER_UNKNOWN",
    ); // HĐ không có đối tác ⇒ không có người ký Bên B
  });
  it("đặt chỗ ký: nhóm ⇒ nhãn «Đại diện …», id lạ bị bỏ (máy chủ sinh), thay toàn bộ, tệp chính mặc định bật nên đặt được ngay", async () => {
    const x = await fixture();
    const alien = Bun.randomUUIDv7();
    const out = await uc().putFields(w(U1), x.id, x.main, [
      { ...f1("user", U1), id: alien },
      f1("group", GROUP),
    ]);
    expect(out.fields.length).toBe(2);
    expect(out.fields.some((f) => f.id === alien)).toBe(false);
    expect(out.fields.find((f) => f.signer_kind === "group")?.label).toBe("Đại diện Ban giám đốc");
    expect(out.fields.find((f) => f.signer_kind === "user")?.mine).toBe(true);
    const keep = out.fields[0]?.id as string;
    const again = await uc().putFields(w(U1), x.id, x.main, [{ ...f1("user", U2), id: keep }]);
    expect(again.fields.map((f) => f.id)).toEqual([keep]);
    const [doc] =
      await o`select needs_sign, pages from contracts.sign_docs where contract_id = ${x.id}`;
    expect(doc).toMatchObject({ needs_sign: true, pages: 3 });
  });
  it("tệp kèm chưa bật «Cần ký» ⇒ not_needed", async () => {
    const x = await fixture();
    expect(await fail(uc().putFields(w(U2), x.id, x.extra, [f1("user", U1)]))).toBe("not_needed");
  });
  it("công ty tắt ⇒ off, HĐ khoá ⇒ locked", async () => {
    const x = await fixture();
    enabled = false;
    expect(await fail(uc().putFields(w(U1), x.id, x.main, []))).toBe("off");
    enabled = true;
    await setStatus(x.id, "processing");
    expect(await fail(uc().putFields(w(U1), x.id, x.main, []))).toBe("locked");
  });
});

describe("CR-181 s8 · người ký + phiên", () => {
  it("signers: Bên A theo company_signers (người ⇒ một, nhóm ⇒ «Đại diện …»), có Bên B khi đối tác có liên hệ email, khác công ty ⇒ null", async () => {
    const x = await fixture();
    const s = await uc().signers(w(U2), x.id);
    expect(s?.signers.map((v) => `${v.side}:${v.kind}:${v.name}:${v.mine}`)).toEqual([
      "A:user:An:false",
      "A:user:Bình:true",
      "A:group:Đại diện Ban giám đốc:false",
    ]);
    expect(await uc().signers(w(U3, T2), x.id)).toBeNull();
  });
  it("session: người tải lên ⇒ prep (readiness nói thiếu), người có lượt (cổng giả) ⇒ sign, người xem ⇒ view, khác công ty ⇒ null", async () => {
    const x = await fixture();
    await uc().putFields(w(U1), x.id, x.main, [f1("user", U1), f1("user", U2)]);
    const prep = await uc().session(w(U1), x.id);
    expect(prep?.mode).toBe("prep");
    expect(prep?.enabled).toBe(true);
    const main = prep?.files.find((f) => f.file_id === x.main);
    expect(main).toMatchObject({ needs_sign: true, is_main: true, can_prep: true, pages: 3 });
    expect(main?.latest).toMatchObject({ version_id: null, seq: 0 });
    expect(main?.fields.map((f) => f.mine)).toEqual([true, false]);
    expect(prep?.files.find((f) => f.file_id === x.word)?.needs_sign).toBe(false);
    expect(prep?.readiness.ready).toBe(false); // thiếu chỗ ký cho nhóm
    expect(prep?.readiness.missing).toHaveLength(1);
    expect(prep?.kinds.digital.enabled).toBe(false);

    turnFor = U2;
    const sign = await uc().session(w(U2), x.id); // U2 tải lên tệp kèm nhưng không phải HĐ chưa khoá? — vẫn là người tải lên ⇒ prep
    expect(sign?.mode).toBe("prep");
    await setStatus(x.id, "processing");
    const s2 = await uc().session(w(U2), x.id);
    expect(s2?.mode).toBe("sign");
    expect(s2?.turn).toMatchObject({ allowed: true, step: "sign" });
    turnFor = null;
    expect((await uc().session(w(U2), x.id))?.mode).toBe("view");
    expect(await uc().session(w(U3, T2), x.id)).toBeNull();
  });
  it("công ty tắt ⇒ session enabled=false, mode view, không tệp", async () => {
    const x = await fixture();
    enabled = false;
    const s = await uc().session(w(U1), x.id);
    enabled = true;
    expect(s).toMatchObject({ enabled: false, mode: "view", files: [] });
  });
});
