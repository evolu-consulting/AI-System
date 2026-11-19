// CR-181 · s8 phần B — Lưu chữ ký + các bản (DB thật, role gói `contracts_rw` + RLS; in PDF thật bằng `stampPdf`; FileBox giả trong bộ nhớ).
// Người có lượt (U2) KHÔNG phải người tạo HĐ (U1) — N2. Khác công ty (U3) thấy 404. Cổng hub giả cho các ca nghiệp vụ; một ca chạy cổng hub THẬT.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { SignSaveBodySchema } from "@ai/contracts/pack-contracts";
import { withHubScope } from "@ai/db/hub-scope";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";
import { connectDb, type Db } from "../../../../lib/db";
import { signaturesRepo } from "../../../signatures/public";
import { createPackUow } from "../../kit/adapters/pack-uow";
import { signHubPort } from "../../packs.sign-doc";
import type { SignDocRepos } from "../application/sign-doc.ports";
import { type SignDocFail, signDocUsecases } from "../application/sign-doc.usecase";
import {
  type SignHubPort,
  type SignSaveDeps,
  signSaveUsecases,
} from "../application/sign-save.usecase";
import { noDigitalSigner, produceSigned } from "../domain/digital-signer";
import type { SignTurnPort } from "../domain/sign-turn.port";
import { contractFilesRepo } from "./contract-files.repo";
import { signDocRepo } from "./sign-doc.repo";
import { signDocsRepo } from "./sign-docs.repo";
import { signFieldsRepo } from "./sign-fields.repo";
import { probePdf } from "./sign-pdf-probe";
import { sha256Hex, stampPdf } from "./sign-stamp.pdf";
import { signVersionsRepo } from "./sign-versions.repo";

let o: Sql;
let db: Db;
let T = "";
let T2 = "";
let U1 = ""; // người tạo HĐ / tải lên
let U2 = ""; // người được giao ký, KHÔNG phải người tạo
let U3 = ""; // công ty khác
const RUN = "7a1d0000-0000-4000-8000-0000000000aa";
const boxes = new Map<string, Uint8Array>();
let puts = 0;
let sqlCount = 0;
const turns = new Set<string>();
let sigMissing = false;

const part = (page: number) => ({
  page,
  x: 40,
  y: 40,
  w: 120,
  h: 50,
  cx: 40,
  cy: 40,
  cw: 120,
  ch: 50,
});
const pngOf = (): Uint8Array => {
  const c = createCanvas(120, 50);
  const g = c.getContext("2d");
  g.fillStyle = "#000";
  g.fillRect(10, 10, 80, 20);
  return c.toBuffer("image/png");
};
const SIG = {
  id: "5160a000-0000-4000-8000-000000000001",
  png: pngOf(),
  caption: "Bình · Giám đốc · Kinh doanh" as string | null,
};
const stamped: { caption?: string; signedOn?: string }[] = [];

const counted = <T extends object>(tx: T): T =>
  new Proxy(tx, {
    get(t, p, r) {
      if (p === "execute")
        return (...a: unknown[]) => {
          sqlCount++;
          return (t as never as { execute: (...x: unknown[]) => unknown }).execute(...a);
        };
      return Reflect.get(t, p, r);
    },
  });
const uow = () =>
  createPackUow(db, "contracts", (tx0, t) => {
    const tx = counted(tx0);
    return {
      contractFiles: contractFilesRepo(tx, t),
      signDoc: signDocRepo(tx, t),
      docs: signDocsRepo(tx, t),
      fields: signFieldsRepo(tx, t),
      versions: signVersionsRepo(tx, t),
    };
  }) as never as import("../../kit/public").PackUow<SignDocRepos>;

const turn: SignTurnPort = {
  turnFor: async (_c, _id, user) =>
    turns.has(user) ? { allowed: true, step: "sign", run_id: RUN } : { allowed: false },
};
const fakeHub: SignHubPort = {
  prepare: async () => ({
    settings: { ink: "blue", initials: "shrink" },
    main: sigMissing ? null : SIG,
    initials: null,
  }),
  audit: async () => undefined,
  userNames: async (_w, ids) => new Map(ids.map((i) => [i, i === U1 ? "An" : "Bình"])),
};
const company = async () => [
  { kind: "user" as const, id: U1, name: "An" },
  { kind: "user" as const, id: U2, name: "Bình" },
];
const base = (hub: SignHubPort = fakeHub): SignSaveDeps => ({
  uow: uow(),
  files: {
    read: async (_o, id) => boxes.get(id) ?? null,
    put: async (_o, _n, bytes) => {
      puts++;
      const fileId = `out-${puts}-${Bun.randomUUIDv7()}`;
      boxes.set(fileId, bytes);
      return { fileId, versionId: "v1" };
    },
    remove: async (_o, id) => void boxes.delete(id),
  },
  maxBytes: 50_000_000,
  hub,
  turn,
  companySigners: company,
  onDocEnabled: async () => true,
  produce: (i) => {
    stamped.push(...i.marks.map((m) => ({ caption: m.caption, signedOn: m.signedOn })));
    return produceSigned({
      pdf: i.pdf,
      marks: i.marks,
      ink: i.ink,
      kind: i.kind,
      signer: noDigitalSigner,
      stamp: stampPdf,
      sha256: sha256Hex,
    });
  },
  newId: () => Bun.randomUUIDv7(),
  now: () => new Date("2026-11-17T08:30:00Z"),
  orgOf: (t) => `t_${t}`,
});
const save = (hub?: SignHubPort) => signSaveUsecases(base(hub));
const prep = () =>
  signDocUsecases({
    uow: uow(),
    files: { read: async (_o, id) => boxes.get(id) ?? null },
    maxBytes: 50_000_000,
    probePdf,
    companySigners: company,
    onDocEnabled: async () => true,
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
async function fixture(pages = 3) {
  const bytes = await pdf(pages);
  const boxId = `fb-${Bun.randomUUIDv7()}`;
  boxes.set(boxId, bytes);
  const [f] = await o<{ id: string }[]>`insert into contracts.files ${o({
    tenant_id: T,
    org: `t_${T}`,
    file_id: boxId,
    name: "hop-dong.pdf",
    mime: "application/pdf",
    size_bytes: bytes.byteLength,
    created_by: U1,
  } as never)} returning id`;
  const [c] = await o<{ id: string }[]>`insert into contracts.contracts ${o({
    tenant_id: T,
    title: "HĐ CR181 s8B",
    created_by: U1,
    status: "draft",
    file_id: (f as { id: string }).id,
  } as never)} returning id`;
  const id = (c as { id: string }).id;
  const fileId = (f as { id: string }).id;
  const put = await prep().putFields(w(U1), id, fileId, [
    { side: "A", signer_kind: "user", signer_ref: U1, parts: [part(0)] },
    { side: "A", signer_kind: "user", signer_ref: U2, parts: [part(0)] },
    { side: "A", signer_kind: "user", signer_ref: U2, parts: [part(1)] },
  ]);
  const mine = (u: string) => put.fields.filter((x) => x.signer_ref === u).map((x) => x.id);
  return { id, fileId, boxId, bytes, u1Field: mine(U1)[0] as string, u2Fields: mine(U2) };
}
const mark = (fieldId?: string) => ({
  ...(fieldId ? { field_id: fieldId } : {}),
  placement: fieldId ? ("field" as const) : ("free" as const),
  parts: [part(0)],
  caption: true,
});
const counts = async (id: string) => {
  const [v] =
    await o`select count(*)::int as n from contracts.sign_versions where contract_id = ${id}`;
  return (v as { n: number }).n;
};

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  [T, T2] = (await tenants(o, 2, 9821)) as [string, string];
  [U1, U2] = (await users(o, T, 2, { from: 9821 })) as [string, string];
  [U3] = (await users(o, T2, 1, { from: 9823 })) as [string];
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-181 s8B · K3 không nhận ảnh", () => {
  it("body có trường ảnh ⇒ schema từ chối (400), digital/placement lạ cũng bị từ chối", () => {
    const ok = {
      kind: "internal",
      marks: [{ placement: "free", parts: [part(0)], caption: true }],
    };
    expect(SignSaveBodySchema.safeParse(ok).success).toBe(true);
    const withImg = { ...ok, marks: [{ ...ok.marks[0], png: "AAAA" }] };
    expect(SignSaveBodySchema.safeParse(withImg).success).toBe(false);
    expect(SignSaveBodySchema.safeParse({ ...ok, image: "AAAA" }).success).toBe(false);
    expect(SignSaveBodySchema.safeParse({ ...ok, marks: [] }).success).toBe(false);
  });
});

describe("CR-181 s8B · Lưu chữ ký", () => {
  it("N2: người có lượt KHÁC người tạo HĐ Lưu được, dấu mang user_signature_id = chữ ký đang dùng (K3), ô đã ký, còn ô ⇒ my_open_fields_left > 0", async () => {
    const x = await fixture();
    turns.add(U2);
    const r = await save().sign(w(U2), x.id, x.fileId, {
      kind: "internal",
      marks: [mark(x.u2Fields[0])],
    });
    expect(r).toMatchObject({ seq: 1, my_open_fields_left: 1 });
    const marks =
      await o`select user_signature_id, signer_id, caption from contracts.sign_marks where version_id = ${r.version_id}`;
    expect(marks.length).toBe(1);
    expect(marks[0]).toMatchObject({ user_signature_id: SIG.id, signer_id: U2 });
    expect(marks[0]?.caption).toBe("Bình · Giám đốc · Kinh doanh");
    // BR-188-2 · dấu in = dòng caption đã lưu + «Ký ngày …» giờ VN (08:30Z ⇒ 15:30), LUÔN có (cờ caption của ô không còn quyết).
    expect(stamped.at(-1)).toEqual({
      caption: "Bình · Giám đốc · Kinh doanh",
      signedOn: "Ký ngày 17/11/2026 15:30",
    });
    const [f] =
      await o`select signed_by, signed_version_id from contracts.sign_fields where id = ${x.u2Fields[0] as string}`;
    expect(f).toMatchObject({ signed_by: U2, signed_version_id: r.version_id });
    const [v] =
      await o`select run_id, signature_kind from contracts.sign_versions where id = ${r.version_id}`;
    expect(v).toMatchObject({ run_id: RUN, signature_kind: "internal" });
    turns.delete(U2);
  });

  it("L1: hai lần Lưu ⇒ seq 1, 2 (lần 2 ký trên bản 1), bản gốc không đổi, ô đã ký không ký lại", async () => {
    const x = await fixture();
    turns.add(U2);
    const before = sha256Hex(boxes.get(x.boxId) as Uint8Array);
    const a = await save().sign(w(U2), x.id, x.fileId, {
      kind: "internal",
      marks: [mark(x.u2Fields[0])],
    });
    const b = await save().sign(w(U2), x.id, x.fileId, {
      kind: "internal",
      marks: [mark(x.u2Fields[1])],
    });
    expect([a.seq, b.seq]).toEqual([1, 2]);
    expect(b.my_open_fields_left).toBe(0);
    expect(sha256Hex(boxes.get(x.boxId) as Uint8Array)).toBe(before);
    const vs =
      await o`select seq, sha256 from contracts.sign_versions where contract_id = ${x.id} order by seq`;
    expect(vs.length).toBe(2);
    expect(vs[0]?.sha256).not.toBe(vs[1]?.sha256);
    expect(
      await fail(
        save().sign(w(U2), x.id, x.fileId, { kind: "internal", marks: [mark(x.u2Fields[0])] }),
      ),
    ).toBe("forbidden");
    turns.delete(U2);
  });

  it("Q12: digital ⇒ 409 NGAY, không in, không bản mới, kho tệp không đổi", async () => {
    const x = await fixture();
    turns.add(U2);
    const p = puts;
    expect(
      await fail(save().sign(w(U2), x.id, x.fileId, { kind: "digital", marks: [mark()] })),
    ).toBe("digital");
    expect(puts).toBe(p);
    expect(await counts(x.id)).toBe(0);
    turns.delete(U2);
  });

  it("C1: ô của người khác ⇒ 403, ô lệch kiểu dấu ⇒ 422, cổng lượt từ chối ⇒ 403 (kể cả người tạo HĐ)", async () => {
    const x = await fixture();
    turns.add(U2);
    expect(
      await fail(
        save().sign(w(U2), x.id, x.fileId, { kind: "internal", marks: [mark(x.u1Field)] }),
      ),
    ).toBe("forbidden");
    expect(
      await fail(
        save().sign(w(U2), x.id, x.fileId, {
          kind: "internal",
          marks: [{ ...mark(x.u2Fields[0]), placement: "free" }],
        }),
      ),
    ).toBe("issue:SIGN_MARK_INVALID");
    turns.delete(U2);
    expect(
      await fail(
        save().sign(w(U1), x.id, x.fileId, { kind: "internal", marks: [mark(x.u1Field)] }),
      ),
    ).toBe("forbidden");
    expect(await counts(x.id)).toBe(0);
  });

  it("K5: chưa có chữ ký ⇒ signature_missing, không bản mới, trang ngoài tệp ⇒ 422 SIGN_PAGE_NOT_FOUND", async () => {
    const x = await fixture();
    turns.add(U2);
    sigMissing = true;
    expect(
      await fail(save().sign(w(U2), x.id, x.fileId, { kind: "internal", marks: [mark()] })),
    ).toBe("signature_missing");
    sigMissing = false;
    const far = { ...mark(), parts: [part(9)] };
    expect(await fail(save().sign(w(U2), x.id, x.fileId, { kind: "internal", marks: [far] }))).toBe(
      "issue:SIGN_PAGE_NOT_FOUND",
    );
    expect(await counts(x.id)).toBe(0);
    turns.delete(U2);
  });

  it("khác công ty ⇒ not_found", async () => {
    const x = await fixture();
    turns.add(U3);
    expect(
      await fail(save().sign(w(U3, T2), x.id, x.fileId, { kind: "internal", marks: [mark()] })),
    ).toBe("not_found");
    turns.delete(U3);
  });
});

describe("CR-181 s8B · X1 xem các bản", () => {
  it("người xem HĐ (không có lượt) liệt kê và tải được mọi bản (kể cả đã huỷ), người ngoài ⇒ null", async () => {
    const x = await fixture();
    turns.add(U2);
    const a = await save().sign(w(U2), x.id, x.fileId, {
      kind: "internal",
      marks: [mark(x.u2Fields[0])],
    });
    await o`update contracts.sign_versions set voided_at = now() where id = ${a.version_id}`;
    await save().sign(w(U2), x.id, x.fileId, { kind: "internal", marks: [mark()] });
    turns.delete(U2);
    const list = await save().versions(w(U1), x.id, x.fileId);
    expect(list?.versions.map((v) => [v.seq, v.voided])).toEqual([
      [0, false],
      [1, true],
      [2, false],
    ]);
    expect(list?.versions[1]).toMatchObject({
      signed_by: U2,
      signed_by_name: "Bình",
      kind: "internal",
    });
    expect(list?.versions[1]?.marks[0]).toMatchObject({
      signer_id: U2,
      placement: "field",
      pages: [0],
    });
    expect(list?.pending_fields.length).toBe(2); // ô của U1 + ô thứ hai của U2 (ô đầu của U2 đã ký ở bản 1)
    for (const v of list?.versions ?? []) {
      const c = await save().content(w(U1), x.id, x.fileId, v.version_id);
      expect(c?.bytes.byteLength).toBeGreaterThan(100);
      expect(Buffer.from(c?.bytes.slice(0, 4) as Uint8Array).toString()).toBe("%PDF");
    }
    expect(await save().versions(w(U3, T2), x.id, x.fileId)).toBeNull();
    expect(await save().content(w(U3, T2), x.id, x.fileId, null)).toBeNull();
    expect(await save().content(w(U1), x.id, x.fileId, Bun.randomUUIDv7())).toBeNull();
  });
});

describe("CR-181 s8B · cổng hub thật (BR-K3, BR-G3)", () => {
  it("signature_for_stamp trả chữ ký ĐANG DÙNG của đúng người, audit document_signed ghi vào hub.audit_log", async () => {
    const hub = signHubPort(db, {} as never);
    const scope = { kind: "user", tenantId: T, userId: U2 } as const;
    const created = await withHubScope(db, scope, (tx) =>
      signaturesRepo(tx).create("main", "type", pngOf(), "Bình · Giám đốc · Kinh doanh"),
    );
    const p = await hub.prepare(w(U2));
    expect(p.main?.id).toBe(created.id);
    expect(p.main?.caption).toBe("Bình · Giám đốc · Kinh doanh"); // BR-188-1 · bản lưu thắng hồ sơ
    expect(p.initials).toBeNull();
    expect(p.settings.ink).toBe("blue");
    const vid = Bun.randomUUIDv7();
    await hub.audit(w(U2), { versionId: vid, fileName: "hd.pdf", summary: { seq: 1 } });
    const rows =
      await o`select actor_id, action, entity, entity_name from hub.audit_log where entity_id = ${vid}`;
    expect(rows[0]).toMatchObject({
      actor_id: U2,
      action: "document_signed",
      entity: "signature",
      entity_name: "hd.pdf",
    });
  });
  it("BR-188-1 · bản không lưu caption (null) ⇒ dựng từ hồ sơ LÚC KÝ (có họ tên)", async () => {
    const hub = signHubPort(db, {} as never);
    const scope = { kind: "user", tenantId: T, userId: U2 } as const;
    await withHubScope(db, scope, (tx) => signaturesRepo(tx).create("main", "type", pngOf()));
    const p = await hub.prepare(w(U2));
    expect(p.main?.caption).toBeTruthy();
  });
});

describe("CR-181 s8B · hiệu năng", () => {
  it("Lưu tệp 50 trang: thời gian + số câu SQL mỗi lần Lưu (cố định)", async () => {
    const x = await fixture(50);
    turns.add(U2);
    const marks = [
      mark(x.u2Fields[0]),
      ...Array.from({ length: 49 }, (_, i) => ({
        placement: "initials" as const,
        parts: [{ ...part(i), w: 48, h: 20, cw: 48, ch: 20 }],
        caption: false,
      })),
    ];
    const run = async (m: typeof marks) => {
      sqlCount = 0;
      const t0 = performance.now();
      await save().sign(w(U2), x.id, x.fileId, { kind: "internal", marks: m });
      return { ms: Math.round(performance.now() - t0), sql: sqlCount };
    };
    await run([mark()]); // khởi động: từ đây luôn có bản trước (cùng số câu SQL đọc nền)
    const a = await run(marks);
    const b = await run([mark(x.u2Fields[1])]);
    console.log(
      `[perf s8B] Lưu 50 trang + 50 dấu: ${a.ms} ms, ${a.sql} câu SQL gói; Lưu 1 dấu: ${b.ms} ms, ${b.sql} câu SQL gói`,
    );
    expect(a.ms).toBeLessThan(3000);
    expect(a.sql).toBe(b.sql); // không phụ thuộc số dấu
    turns.delete(U2);
  });
});
