// CR-133 · «Tài liệu kèm» trên HĐ (DB thật, role gói `contracts_rw` + RLS): đường chính thêm → liệt kê (hai nhóm) → link tải → gỡ; 415/quyền/trần;
// và chặn đọc chéo công ty cho bảng mới `contracts.contract_files`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../../lib/db";
import { createPackUow } from "../../kit/adapters/pack-uow";
import {
  type ContractFilesFail,
  type ContractFilesRepos,
  contractFilesUsecases,
} from "../application/contract-files.usecase";
import { MAX_CONTRACT_FILES } from "../domain/contract-files.rules";
import { contractFilesRepo } from "./contract-files.repo";

let o: Sql;
let db: Db;
let T = "";
let T2 = "";
let U1 = ""; // người tạo HĐ
let U2 = ""; // người khác cùng công ty
let U3 = ""; // công ty khác
let seq = 0;
const removed: string[] = [];

const uow = () =>
  createPackUow(db, "contracts", (tx, t) => ({
    contractFiles: contractFilesRepo(tx, t),
  })) as never as import("../../kit/public").PackUow<ContractFilesRepos>;
const uc = () =>
  contractFilesUsecases({
    uow: uow(),
    files: {
      put: async () => ({ fileId: `fb-${++seq}`, versionId: `v-${seq}` }),
      remove: async (_org, id) => void removed.push(id),
    },
    stepFiles: async () => [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "bien-ban.pdf",
        mime: "application/pdf",
        size: 5,
        source: "form",
        added_at: new Date(0),
      },
    ],
    link: async (_org, fileId) => `https://fb.test/d/${fileId}`,
    newId: () => Bun.randomUUIDv7(),
  });
const editor = { admin: false, write: true };
const admin = { admin: true, write: true };
const w = (userId: string, tenantId = T) => ({ tenantId, userId });
const docx = (name = "phu-luc.docx") => ({ name, bytes: new Uint8Array([1, 2, 3]) });
const fail = async (p: Promise<unknown>) =>
  ((await p.catch((x: unknown) => x)) as ContractFilesFail).kind;

async function mk(): Promise<string> {
  const [r] = await o<{ id: string }[]>`insert into contracts.contracts ${o({
    tenant_id: T,
    title: "HĐ CR133",
    created_by: U1,
    status: "draft",
  } as never)} returning id`;
  return (r as { id: string }).id;
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  [T, T2] = (await tenants(o, 2, 9331)) as [string, string];
  [U1, U2] = (await users(o, T, 2, { from: 9331 })) as [string, string];
  [U3] = (await users(o, T2, 1, { from: 9333 })) as [string];
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-133 · Tài liệu kèm — đường chính", () => {
  it("thêm → liệt kê hai nhóm → link tải → gỡ (người gắn gỡ được tệp của mình, tệp bị đánh dấu xoá)", async () => {
    const id = await mk();
    const empty = await uc().list(w(U1), id, editor);
    expect(empty?.files).toEqual([]);
    expect(empty?.can_add).toBe(true);

    const added = await uc().add(w(U1), id, editor, docx());
    expect(added.name).toBe("phu-luc.docx");
    const l = await uc().list(w(U1), id, editor);
    expect(l?.files.map((f) => f.name)).toEqual(["phu-luc.docx"]);
    expect(l?.files[0]?.can_remove).toBe(true);
    expect(l?.steps.map((s) => s.name)).toEqual(["bien-ban.pdf"]);

    expect(await uc().link(w(U1), id, added.id)).toMatch(/^https:\/\/fb\.test\/d\/fb-/);
    // Người khác cùng công ty (không tạo/phụ trách, không gắn tệp): thấy nhưng không có quyền sửa.
    const other = await uc().list(w(U2), id, editor);
    expect(other?.can_add).toBe(false);
    expect(other?.files[0]?.can_remove).toBe(false);
    expect(await fail(uc().remove(w(U2), id, added.id, editor))).toBe("forbidden");

    await uc().remove(w(U1), id, added.id, editor);
    expect((await uc().list(w(U1), id, editor))?.files).toEqual([]);
    const [f] = await o`select deleted_at from contracts.files where id = ${added.id}`;
    expect(f?.deleted_at).not.toBeNull();
    expect(await uc().link(w(U1), id, added.id)).toBeNull();
  });

  it("đuôi lạ ⇒ file_type (không đụng kho); người ghi khác không tạo/phụ trách ⇒ forbidden; quản trị thêm được; đủ trần ⇒ full", async () => {
    const id = await mk();
    const before = seq;
    expect(await fail(uc().add(w(U1), id, editor, docx("a.doc")))).toBe("file_type");
    expect(seq).toBe(before);
    expect(await fail(uc().add(w(U2), id, editor, docx()))).toBe("forbidden");
    await uc().add(w(U2), id, admin, docx("quan-tri.xlsx"));
    for (let i = 1; i < MAX_CONTRACT_FILES; i++)
      await uc().add(w(U1), id, editor, docx(`f${i}.docx`));
    const gone = removed.length;
    expect(await fail(uc().add(w(U1), id, editor, docx("thua.docx")))).toBe("full");
    expect(removed.length).toBe(gone); // đã chặn trước khi đưa lên kho
  });
});

describe("CR-133 · chặn đọc chéo công ty (contracts.contract_files)", () => {
  it("công ty khác: không thấy HĐ, không thêm / gỡ / lấy link, đếm bảng = 0 dù hàng có thật", async () => {
    const id = await mk();
    const a = await uc().add(w(U1), id, editor, docx());
    expect(await uc().list(w(U3, T2), id, admin)).toBeNull();
    expect(await fail(uc().add(w(U3, T2), id, admin, docx()))).toBe("not_found");
    expect(await fail(uc().remove(w(U3, T2), id, a.id, admin))).toBe("not_found");
    expect(await uc().link(w(U3, T2), id, a.id)).toBeNull();
    const seen = await uow().tenant(w(U3, T2), (r) => r.contractFiles.count(id));
    expect(seen).toBe(0);
    expect((await o`select 1 from contracts.contract_files where contract_id = ${id}`).length).toBe(
      1,
    );
  });
});
