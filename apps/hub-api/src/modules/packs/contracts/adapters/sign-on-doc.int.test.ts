// CR-181 · lát s6 — bảng ký trên tài liệu (DB thật, role gói `contracts_rw` + RLS): cờ «Cần ký», chỗ ký, bản đã ký + dấu.
// Ca: khác công ty không đọc/ghi được; seq không trùng khi hai lần thêm bản đồng thời; void theo lượt chỉ đụng bản của lượt đó;
// thay chỗ ký tệp A không đụng tệp B; `parts` jsonb khớp `SignPartsSchema`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { SignPartsSchema } from "@ai/contracts/pack-contracts";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../../lib/db";
import { createPackUow } from "../../kit/adapters/pack-uow";
import { signDocsRepo } from "./sign-docs.repo";
import { type NewSignField, signFieldsRepo } from "./sign-fields.repo";
import { type NewSignMark, signVersionsRepo } from "./sign-versions.repo";

let o: Sql;
let db: Db;
let T = "";
let T2 = "";
let U1 = ""; // người tạo HĐ / người ký 1
let U2 = ""; // người được giao, không phải người tạo
let U3 = ""; // công ty khác

const mkUow = () =>
  createPackUow(db, "contracts", (tx, t) => ({
    docs: signDocsRepo(tx, t),
    fields: signFieldsRepo(tx, t),
    versions: signVersionsRepo(tx, t),
  }));
const w = (userId: string, tenantId = T) => ({ tenantId, userId });

const part = (page: number) => ({
  page,
  x: 100,
  y: 100,
  w: 120,
  h: 50,
  cx: 100,
  cy: 100,
  cw: 120,
  ch: 50,
});
const parts1 = [part(0)];
const seam = [part(1), part(2)];

async function mkContract(tenant = T, by = U1): Promise<string> {
  const [r] = await o<{ id: string }[]>`insert into contracts.contracts ${o({
    tenant_id: tenant,
    title: "HĐ CR181",
    created_by: by,
    status: "draft",
  } as never)} returning id`;
  return (r as { id: string }).id;
}
async function mkFile(tenant = T, by = U1): Promise<string> {
  const [r] = await o<{ id: string }[]>`insert into contracts.files ${o({
    tenant_id: tenant,
    org: `t_${tenant}`,
    file_id: `fb-${Bun.randomUUIDv7()}`,
    name: "hd.pdf",
    mime: "application/pdf",
    size_bytes: 10,
    created_by: by,
  } as never)} returning id`;
  return (r as { id: string }).id;
}
const sha = "a".repeat(64);
const mark = (fieldId: string | null = null, p = parts1): NewSignMark => ({
  fieldId,
  placement: fieldId ? "field" : "free",
  parts: p,
  userSignatureId: Bun.randomUUIDv7(),
  caption: "Nguyễn Văn A · 17/11/2026",
});
const field = (p = parts1, signerRef = U1): NewSignField => ({
  id: Bun.randomUUIDv7(),
  side: "A",
  signerKind: "user",
  signerRef,
  label: "Bên A",
  parts: p,
});

/** Một HĐ + tệp gốc đã đặt «Cần ký». */
async function setup(): Promise<{ c: string; f: string }> {
  const c = await mkContract();
  const f = await mkFile();
  const d = await mkUow().tenant(w(U1), (r) => r.docs.set(c, f, true, 3, U1));
  expect(d?.needs_sign).toBe(true);
  return { c, f };
}
async function addV(
  c: string,
  f: string,
  by: string,
  runId: string | null,
  marks: NewSignMark[] = [mark()],
) {
  const out = await mkFile();
  return mkUow().tenant(w(by), (r) =>
    r.versions.add({
      id: Bun.randomUUIDv7(),
      contractId: c,
      fileId: f,
      outFileId: out,
      sha256: sha,
      signedBy: by,
      kind: "internal",
      runId,
      marks,
    }),
  );
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 6);
  [T, T2] = (await tenants(o, 2, 9811)) as [string, string];
  [U1, U2] = (await users(o, T, 2, { from: 9811 })) as [string, string];
  [U3] = (await users(o, T2, 1, { from: 9813 })) as [string];
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-181 s6 · cờ «Cần ký» (sign_docs)", () => {
  it("đặt → đọc → đổi cờ giữ số trang khi pages null; HĐ không có ⇒ null", async () => {
    const { c, f } = await setup();
    const u = mkUow();
    const got = await u.tenant(w(U2), (r) => r.docs.get(c, f)); // người được giao đọc được
    expect(got).toMatchObject({ file_id: f, needs_sign: true, pages: 3, set_by: U1 });
    const off = await u.tenant(w(U2), (r) => r.docs.set(c, f, false, null, U2));
    expect(off).toMatchObject({ needs_sign: false, pages: 3, set_by: U2 });
    const list = await u.tenant(w(U1), (r) => r.docs.listByContract(c));
    expect(list.map((x) => x.file_id)).toEqual([f]);
    expect(await u.tenant(w(U1), (r) => r.docs.set(Bun.randomUUIDv7(), f, true, 1, U1))).toBeNull();
  });
});

describe("CR-181 s6 · RLS khác công ty", () => {
  it("công ty khác không đọc/ghi được cả bốn bảng", async () => {
    const { c, f } = await setup();
    await mkUow().tenant(w(U1), (r) => r.fields.replaceForFile(c, f, [field()], U1));
    expect(await addV(c, f, U1, null)).not.toBeNull();
    const u = mkUow();
    const seen = await u.tenant(w(U3, T2), async (r) => ({
      doc: await r.docs.get(c, f),
      docs: await r.docs.listByContract(c),
      fields: await r.fields.listByContract(c),
      latest: await r.versions.latest(c, f),
      list: await r.versions.list(c, f),
    }));
    expect(seen.doc).toBeNull();
    expect(seen.docs).toHaveLength(0);
    expect(seen.fields).toHaveLength(0);
    expect(seen.latest).toBeNull();
    expect(seen.list).toHaveLength(0);
    // ghi chéo công ty: HĐ không thuộc tenant ⇒ set không có hàng; add không có sign_docs ⇒ null
    expect(await u.tenant(w(U3, T2), (r) => r.docs.set(c, f, true, 1, U3))).toBeNull();
    const out2 = await mkFile(T2, U3);
    const add = await u.tenant(w(U3, T2), (r) =>
      r.versions.add({
        id: Bun.randomUUIDv7(),
        contractId: c,
        fileId: f,
        outFileId: out2,
        sha256: sha,
        signedBy: U3,
        kind: "internal",
        runId: null,
        marks: [mark()],
      }),
    );
    expect(add).toBeNull();
    const marks =
      await o`select count(*)::int as n from contracts.sign_marks where tenant_id = ${T2}`;
    expect(marks[0]?.n).toBe(0);
  });
});

describe("CR-181 s6 · chỗ ký (sign_fields)", () => {
  it("thay chỗ ký tệp A không đụng tệp B; parts jsonb khớp SignPartsSchema", async () => {
    const c = await mkContract();
    const a = await mkFile();
    const b = await mkFile();
    const u = mkUow();
    await u.tenant(w(U1), async (r) => {
      await r.docs.set(c, a, true, 5, U1);
      await r.docs.set(c, b, true, 5, U1);
    });
    const fa = [field(parts1), field(seam, U2)];
    const fb = [field(parts1)];
    await u.tenant(w(U1), async (r) => {
      await r.fields.replaceForFile(c, a, fa, U1);
      await r.fields.replaceForFile(c, b, fb, U1);
    });
    // A: bỏ chỗ thứ hai, đổi nhãn chỗ đầu, thêm một chỗ mới
    const fa2 = [{ ...(fa[0] as NewSignField), label: "Đổi nhãn" }, field(parts1, U2)];
    const res = await u.tenant(w(U2), (r) => r.fields.replaceForFile(c, a, fa2, U2));
    expect(res).toEqual({ removed: 1, upserted: 2 });
    const la = await u.tenant(w(U1), (r) => r.fields.listByFile(c, a));
    expect(la.map((x) => x.id).sort()).toEqual(fa2.map((x) => x.id).sort());
    expect(la.find((x) => x.id === fa2[0]?.id)).toMatchObject({
      label: "Đổi nhãn",
      created_by: U1,
    });
    for (const x of la) expect(SignPartsSchema.safeParse(x.parts).success).toBe(true);
    const lb = await u.tenant(w(U1), (r) => r.fields.listByFile(c, b));
    expect(lb.map((x) => x.id)).toEqual([(fb[0] as NewSignField).id]);
    const all = await u.tenant(w(U1), (r) => r.fields.listByContract(c));
    expect(all).toHaveLength(3);
    // giáp lai 2 trang lưu/đọc nguyên vẹn
    const sf = await u.tenant(w(U1), (r) => r.fields.replaceForFile(c, b, [field(seam)], U1));
    expect(sf.upserted).toBe(1);
    const seamRow = (await u.tenant(w(U1), (r) => r.fields.listByFile(c, b)))[0];
    expect(SignPartsSchema.parse(seamRow?.parts)).toEqual(seam);
  });

  it("chỗ đã ký là lịch sử: replace không xoá/sửa; markSigned; void mở lại", async () => {
    const { c, f } = await setup();
    const u = mkUow();
    const f1 = field();
    const f2 = field(parts1, U2);
    await u.tenant(w(U1), (r) => r.fields.replaceForFile(c, f, [f1, f2], U1));
    const run = Bun.randomUUIDv7();
    const v = await addV(c, f, U1, run, [mark(f1.id)]);
    expect(v?.seq).toBe(1);
    expect(await u.tenant(w(U1), (r) => r.fields.markSigned(c, [f1.id], U1, v?.id as string))).toBe(
      1,
    );
    // đánh dấu lần hai không đổi (đã ký)
    expect(await u.tenant(w(U1), (r) => r.fields.markSigned(c, [f1.id], U2, v?.id as string))).toBe(
      0,
    );
    // thay: chỉ gửi f2 đổi nhãn ⇒ f1 (đã ký) giữ nguyên
    await u.tenant(w(U1), (r) => r.fields.replaceForFile(c, f, [{ ...f2, label: "mới" }], U1));
    const rows = await u.tenant(w(U1), (r) => r.fields.listByFile(c, f));
    expect(rows.map((x) => x.id).sort()).toEqual([f1.id, f2.id].sort());
    expect(rows.find((x) => x.id === f1.id)).toMatchObject({
      signed_by: U1,
      signed_version_id: v?.id,
    });
    // void theo lượt ⇒ chỗ f1 mở lại
    const voided = await u.tenant(w(U1), (r) => r.versions.voidByRun(run));
    expect(voided.map((x) => x.id)).toEqual([v?.id as string]);
    const after = await u.tenant(w(U1), (r) => r.fields.listByFile(c, f));
    expect(after.find((x) => x.id === f1.id)).toMatchObject({
      signed_by: null,
      signed_version_id: null,
    });
  });
});

describe("CR-181 s6 · bản đã ký + dấu (sign_versions, sign_marks)", () => {
  it("seq tăng 1,2,3; latest = bản mới nhất; list kèm dấu; parts khớp schema", async () => {
    const { c, f } = await setup();
    const v1 = await addV(c, f, U1, null, [mark(null, parts1), mark(null, seam)]);
    const v2 = await addV(c, f, U2, null, [mark()]);
    expect([v1?.seq, v2?.seq]).toEqual([1, 2]);
    const u = mkUow();
    const latest = await u.tenant(w(U2), (r) => r.versions.latest(c, f));
    expect(latest).toMatchObject({
      id: v2?.id,
      seq: 2,
      signed_by: U2,
      signature_kind: "internal",
      voided_at: null,
    });
    const byC = await u.tenant(w(U2), (r) => r.versions.latestByContract(c));
    expect(byC.map((x) => x.id)).toEqual([v2?.id as string]);
    const list = await u.tenant(w(U1), (r) => r.versions.list(c, f));
    expect(list.map((x) => [x.seq, x.marks.length])).toEqual([
      [1, 2],
      [2, 1],
    ]);
    for (const m of list[0]?.marks ?? []) {
      expect(SignPartsSchema.safeParse(m.parts).success).toBe(true);
      expect(m.signer_id).toBe(U1);
    }
    expect(SignPartsSchema.parse(list[0]?.marks[1]?.parts)).toEqual(seam);
    expect(await u.tenant(w(U1), (r) => r.versions.latest(c, Bun.randomUUIDv7()))).toBeNull();
  });

  it("thêm bản cho tệp chưa có sign_docs ⇒ null; hai lần thêm ĐỒNG THỜI ⇒ seq khác nhau, không lỗi trùng", async () => {
    const c = await mkContract();
    const f0 = await mkFile();
    expect(await addV(c, f0, U1, null)).toBeNull();
    const { c: c2, f } = await setup();
    const rs = await Promise.all(
      Array.from({ length: 6 }, (_, i) => addV(c2, f, i % 2 ? U1 : U2, null)),
    );
    const seqs = rs.map((r) => r?.seq).sort();
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("void theo run_id chỉ đụng bản của lượt đó; latest bỏ bản void; seq vẫn tăng tiếp", async () => {
    const { c, f } = await setup();
    const runA = Bun.randomUUIDv7();
    const runB = Bun.randomUUIDv7();
    const a1 = await addV(c, f, U1, runA);
    const b1 = await addV(c, f, U2, runB);
    const a2 = await addV(c, f, U1, runA);
    const u = mkUow();
    const voided = await u.tenant(w(U2), (r) => r.versions.voidByRun(runA));
    expect(voided.map((x) => x.id).sort()).toEqual([a1?.id as string, a2?.id as string].sort());
    const list = await u.tenant(w(U1), (r) => r.versions.list(c, f));
    expect(list.map((x) => [x.seq, x.voided_at !== null])).toEqual([
      [1, true],
      [2, false],
      [3, true],
    ]);
    expect((await u.tenant(w(U1), (r) => r.versions.latest(c, f)))?.id).toBe(b1?.id as string);
    expect(list[0]?.marks).toHaveLength(1); // bản void vẫn xem được trong lịch sử
    // gọi lại ⇒ không còn gì để void; lượt khác công ty không đụng
    expect(await u.tenant(w(U1), (r) => r.versions.voidByRun(runA))).toHaveLength(0);
    expect(await u.tenant(w(U3, T2), (r) => r.versions.voidByRun(runB))).toHaveLength(0);
    const next = await addV(c, f, U1, null);
    expect(next?.seq).toBe(4);
  });
});

describe("CR-181 s6 · ràng buộc dữ liệu", () => {
  it("CHECK enum/parts và FK tệp: giá trị sai bị DB từ chối", async () => {
    const { c, f } = await setup();
    const bad = (q: Promise<unknown>) => q.then(() => "ok").catch(() => "reject");
    expect(
      await bad(
        o`insert into contracts.sign_fields (tenant_id, contract_id, file_id, side, signer_kind, signer_ref, parts, created_by)
          values (${T}, ${c}, ${f}, 'C', 'user', 'x', '[{}]'::jsonb, ${U1})`,
      ),
    ).toBe("reject");
    expect(
      await bad(
        o`insert into contracts.sign_fields (tenant_id, contract_id, file_id, side, signer_kind, signer_ref, parts, created_by)
          values (${T}, ${c}, ${f}, 'A', 'user', 'x', '[]'::jsonb, ${U1})`,
      ),
    ).toBe("reject");
    expect(
      await bad(
        o`insert into contracts.sign_docs (tenant_id, contract_id, file_id, set_by)
          values (${T}, ${c}, ${Bun.randomUUIDv7()}, ${U1})`,
      ),
    ).toBe("reject");
  });
});
