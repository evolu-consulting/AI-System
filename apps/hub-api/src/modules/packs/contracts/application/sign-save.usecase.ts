// CR-181 · s8 phần B · Lưu chữ ký + các bản (lớp 2, không SQL). Thứ tự `sign`: lượt (403) → digital (409, TRƯỚC khi in) → dấu vào ô phải là chỗ CHƯA ký của
// chính người gọi (403, C1) → chữ ký lấy từ hub theo người gọi (K3/K5) → nền = bản mới nhất chưa huỷ, không có thì bản gốc (L1) → in (`produce`) → lưu tệp ra
// (FileBox ngoài tx) → một tx: khoá `sign_docs`, kiểm bản mới nhất không đổi, ghi tệp + bản + dấu + đánh dấu chỗ ký → audit `document_signed` (BR-G3).
import type {
  SignatureKind,
  SignParts,
  SignSaveBody,
  SignSaveOut,
  SignVersionItemOut,
  SignVersionsOut,
} from "@ai/contracts/pack-contracts";
import type { PackUow, PackWho } from "../../kit/public";
import {
  canPrepSign,
  captionText,
  defaultNeedsSign,
  isPdfFile,
  marksIssue,
  PARTNER_REF_MASK,
  uploaderOf,
} from "../domain/sign.rules";
import { SignError } from "../domain/sign-error";
import type { SignTurnPort } from "../domain/sign-turn.port";
import type {
  OutFileRef,
  SignDocRepos,
  SignDocRowP,
  SignFieldRowP,
  SignFileRef,
  SignVersionRowP,
} from "./sign-doc.ports";
import { buildSigners, type CompanySigner, fieldOut, SignDocFail } from "./sign-doc.usecase";

export type StampSettings = {
  ink: "blue" | "black";
  caption: readonly ("name" | "title" | "date" | "time")[];
  initials: "shrink" | "own";
};
type Sig = { id: string; png: Uint8Array };
/** Cổng hub (gói không import module hub): chữ ký + thiết lập + hồ sơ người gọi, audit, tên người. */
export type SignHubPort = {
  prepare(who: PackWho): Promise<{
    settings: StampSettings;
    name: string;
    title: string | null;
    main: Sig | null;
    initials: Sig | null;
  }>;
  audit(
    who: PackWho,
    e: { versionId: string; fileName: string; summary: Record<string, unknown> },
  ): Promise<void>;
  userNames(who: PackWho, ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
};
export type StampMarkIn = { png: Uint8Array; parts: SignParts; caption?: string };

export type SignSaveDeps = {
  uow: PackUow<SignDocRepos>;
  files: {
    read(org: string, boxId: string, maxBytes: number): Promise<Uint8Array | null>;
    put(
      org: string,
      name: string,
      bytes: Uint8Array,
    ): Promise<{ fileId: string; versionId: string }>;
    remove(org: string, fileId: string): Promise<void>;
  };
  maxBytes: number;
  hub: SignHubPort;
  turn: SignTurnPort;
  companySigners: (who: PackWho, contractId: string) => Promise<CompanySigner[]>;
  onDocEnabled: (who: PackWho) => Promise<boolean>;
  /** `produceSigned` đã nối `stampPdf`/`sha256Hex`/bộ ký số. */
  produce: (i: {
    pdf: Uint8Array;
    marks: readonly StampMarkIn[];
    ink: "blue" | "black";
    kind: SignatureKind;
    who: PackWho;
  }) => Promise<{ bytes: Uint8Array; sha256: string; pages: number }>;
  newId: () => string;
  now: () => Date;
  orgOf: (tenantId: string) => string;
  /** CR-181 · s9 · SAU COMMIT: bước Ký `ondoc` của lượt đủ ô Bên A ⇒ thả bước (không ném). Vắng ⇒ không báo. */
  onSigned?: (who: PackWho, contractId: string, runId: string) => Promise<void>;
};

const urlOf = (id: string, fileId: string, vid: string | null) =>
  vid
    ? `/contracts/${id}/sign-docs/${fileId}/versions/${vid}/content`
    : `/contracts/${id}/sign-docs/${fileId}/content`;
const iso = (d: Date | string): string => new Date(d).toISOString();
const stem = (name: string) => name.replace(/\.pdf$/i, "");

export type SignSaveUsecases = ReturnType<typeof signSaveUsecases>;

type Snap = {
  file: SignFileRef;
  doc: SignDocRowP | null;
  latest: SignVersionRowP | null;
  fields: SignFieldRowP[];
  base: OutFileRef | null;
};
type Render = {
  out: { bytes: Uint8Array; sha256: string; pages: number };
  used: Sig[];
  text: string | undefined;
};

function helpers(d: SignSaveDeps) {
  return {
    async load(who: PackWho, id: string, fileId: string): Promise<Snap> {
      return d.uow.tenant(who, async (r) => {
        if (!(await r.contractFiles.facts(id))) throw new SignDocFail("not_found");
        const file = (await r.signDoc.files(id)).find((f) => f.file_id === fileId);
        if (!file) throw new SignDocFail("not_found");
        const latest = await r.versions.latest(id, fileId);
        return {
          file,
          doc: await r.docs.get(id, fileId),
          latest,
          fields: await r.fields.listByFile(id, fileId),
          base: latest ? await r.signDoc.outFileById(latest.out_file_id) : null,
        };
      });
    },
    /** Lượt (403) → digital (409) → cờ «Cần ký» → dấu vào ô là của chính người gọi (403/422). Trả người ký (để biết ô của mình). */
    async authorize(who: PackWho, id: string, body: SignSaveBody, snap: Snap, enabled: boolean) {
      if (!enabled) throw new SignDocFail("off");
      const turn = await d.turn.turnFor(who, id, who.userId);
      if (!turn.allowed) throw new SignDocFail("forbidden");
      if (body.kind === "digital") throw new SignDocFail("digital"); // Q12 · trước khi in: tệp và DB không đổi
      const f = { is_main: snap.file.is_main, is_pdf: isPdfFile(snap.file) };
      if (!(snap.doc ? snap.doc.needs_sign : defaultNeedsSign(f, enabled)))
        throw new SignDocFail("not_needed");
      const signers = buildSigners(await d.companySigners(who, id), null, who.userId);
      const bad = marksIssue(body.marks, snap.fields, signers);
      if (bad === "forbidden") throw new SignDocFail("forbidden");
      if (bad) throw new SignDocFail("issue", "SIGN_MARK_INVALID");
      return { turn, signers };
    },
    /** Chữ ký của người gọi (K3/K5) + nền (L1) → in. */
    async render(who: PackWho, body: SignSaveBody, snap: Snap): Promise<Render> {
      const h = await d.hub.prepare(who);
      const used: Sig[] = [];
      for (const m of body.marks) {
        const s = m.placement === "initials" && h.settings.initials === "own" ? h.initials : h.main;
        if (!s) throw new SignDocFail("signature_missing"); // K5
        used.push(s);
      }
      const text = captionText(h.settings.caption, { name: h.name, title: h.title }, d.now());
      const marks: StampMarkIn[] = body.marks.map((m, i) => ({
        png: (used[i] as Sig).png,
        parts: m.parts,
        ...(m.caption && text ? { caption: text } : {}),
      }));
      const ref = snap.base ?? snap.file;
      const pdf = await d.files.read(ref.org, ref.box_id, d.maxBytes);
      if (!pdf) throw new SignDocFail("issue", "SIGN_PDF_INVALID");
      const out = await d
        .produce({ pdf, marks, ink: h.settings.ink, kind: body.kind, who })
        .catch((e: unknown) => {
          if (!(e instanceof SignError)) throw e;
          throw e.code === "DIGITAL_SIGN_NOT_ENABLED"
            ? new SignDocFail("digital")
            : new SignDocFail("issue", e.code);
        });
      return { out, used, text };
    },
  };
}

/** s9 · soát s8 #3 (TOCTOU): lượt ký kiểm lại SAU khi khoá tệp — bước đã đổi / lượt khác ⇒ bỏ (bản ghi đúng `run_id` của lượt). */
async function turnStill(d: SignSaveDeps, who: PackWho, id: string, runId: string | null) {
  const now = await d.turn.turnFor(who, id, who.userId);
  if (!now.allowed || (now.run_id ?? null) !== runId) throw new SignDocFail("forbidden");
}
/** s9 · soát s8 #4: chỗ ký vừa bị người khác ký / không thuộc tệp ⇒ số dòng ≠ số chỗ ⇒ stale (rollback cả bản). */
async function markAll(
  r: Pick<SignDocRepos, "fields">,
  id: string,
  fieldIds: readonly string[],
  by: string,
  versionId: string,
) {
  const want = new Set(fieldIds).size;
  if (want === 0) return;
  if ((await r.fields.markSigned(id, fieldIds, by, versionId)) !== want)
    throw new SignDocFail("stale");
}

export function signSaveUsecases(d: SignSaveDeps) {
  const h = helpers(d);
  return {
    /** BR-L1/L2/K3 · Lưu chữ ký của người gọi lên tệp: tạo MỘT bản mới. */
    async sign(who: PackWho, id: string, fileId: string, body: SignSaveBody): Promise<SignSaveOut> {
      const enabled = await d.onDocEnabled(who);
      const snap = await h.load(who, id, fileId);
      const { turn, signers } = await h.authorize(who, id, body, snap, enabled);
      const { out, used, text } = await h.render(who, body, snap);
      const orgOut = d.orgOf(who.tenantId);
      const outName = `${stem(snap.file.name)} (đã ký).pdf`;
      const put = await d.files.put(orgOut, outName, out.bytes);
      const fieldIds = body.marks.flatMap((m) => (m.field_id ? [m.field_id] : []));
      const res = await d.uow
        .tenant(who, async (r) => {
          if (!(await r.signDoc.lockDoc(id, fileId))) throw new SignDocFail("not_found");
          await turnStill(d, who, id, turn.run_id ?? null);
          const cur = await r.versions.latest(id, fileId);
          if ((cur?.id ?? null) !== (snap.latest?.id ?? null)) throw new SignDocFail("stale");
          const outRowId = d.newId();
          await r.signDoc.insertOutFile({
            id: outRowId,
            org: orgOut,
            boxId: put.fileId,
            versionId: put.versionId,
            name: outName,
            size: out.bytes.byteLength,
            by: who.userId,
          });
          const v = await r.versions.add({
            id: d.newId(),
            contractId: id,
            fileId,
            outFileId: outRowId,
            sha256: out.sha256,
            signedBy: who.userId,
            kind: body.kind,
            runId: turn.run_id ?? null,
            marks: body.marks.map((m, i) => ({
              fieldId: m.field_id ?? null,
              placement: m.placement,
              parts: m.parts,
              userSignatureId: (used[i] as Sig).id,
              caption: m.caption ? (text ?? null) : null,
            })),
          });
          if (!v) throw new SignDocFail("not_found");
          await markAll(r, id, fieldIds, who.userId, v.id);
          const all = await r.fields.listByContract(id);
          const mine = (f: { signer_kind: string; signer_ref: string }) =>
            signers.some(
              (s) =>
                s.mine &&
                s.kind === f.signer_kind &&
                s.ref.toLowerCase() === f.signer_ref.toLowerCase(),
            );
          const left = all.filter((f) => f.signed_version_id === null && mine(f)).length;
          return { version_id: v.id, seq: v.seq, my_open_fields_left: left };
        })
        .catch(async (e: unknown) => {
          await d.files.remove(orgOut, put.fileId).catch(() => undefined);
          throw e;
        });
      // Đã lưu bản; nhật ký lỗi không làm hỏng lần Lưu (cổng tự ghi cảnh báo).
      await d.hub
        .audit(who, {
          versionId: res.version_id,
          fileName: snap.file.name,
          summary: {
            contract_id: id,
            file_id: fileId,
            seq: res.seq,
            kind: body.kind,
            marks: body.marks.length,
            fields: fieldIds,
            run_id: turn.run_id ?? null,
            sha256: out.sha256,
          },
        })
        .catch(() => undefined);
      // s9 · BR-D3/C4 · Q8 · sau COMMIT: đủ ô Bên A của bước Ký `ondoc` ⇒ thả bước chờ (cổng tự nuốt lỗi).
      if (turn.run_id && d.onSigned) await d.onSigned(who, id, turn.run_id).catch(() => undefined);
      return res;
    },

    /** BR-X1 · mọi bản (kể cả đã huỷ) + chỗ ký còn chờ; quyền xem HĐ. null = không thấy (404). */
    async versions(who: PackWho, id: string, fileId: string): Promise<SignVersionsOut | null> {
      const snap = await d.uow.tenant(who, async (r) => {
        const facts = await r.contractFiles.facts(id);
        if (!facts) return null;
        const file = (await r.signDoc.files(id)).find((f) => f.file_id === fileId);
        if (!file) return null;
        return {
          facts,
          file,
          doc: await r.docs.get(id, fileId),
          versions: await r.versions.list(id, fileId),
          fields: await r.fields.listByFile(id, fileId),
        };
      });
      if (!snap) return null;
      const people = new Set<string>();
      for (const v of snap.versions) {
        people.add(v.signed_by);
        for (const m of v.marks) people.add(m.signer_id);
      }
      const names = await d.hub.userNames(who, [...people]);
      const signers = buildSigners(await d.companySigners(who, id), null, who.userId);
      const prep = canPrepSign(
        who.userId,
        uploaderOf(snap.file, snap.facts.created_by),
        snap.facts,
      );
      const versions: SignVersionItemOut[] = [
        {
          version_id: null,
          seq: 0,
          original: true,
          signed_by: null,
          signed_by_name: null,
          signed_at: null,
          kind: null,
          voided: false,
          sha256: null,
          url: urlOf(id, fileId, null),
          marks: [],
        },
        ...snap.versions.map(
          (v): SignVersionItemOut => ({
            version_id: v.id,
            seq: v.seq,
            original: false,
            signed_by: v.signed_by,
            signed_by_name: names.get(v.signed_by) ?? null,
            signed_at: iso(v.created_at),
            kind: v.signature_kind,
            voided: v.voided_at !== null,
            sha256: v.sha256,
            url: urlOf(id, fileId, v.id),
            marks: v.marks.map((m) => ({
              signer_id: m.signer_id,
              signer_name: names.get(m.signer_id) ?? null,
              field_id: m.field_id,
              placement: m.placement,
              pages: m.parts.map((p) => p.page),
              parts: m.parts,
              caption: m.caption,
            })),
          }),
        ),
      ];
      return {
        file_id: fileId,
        name: snap.file.name,
        pages: snap.doc?.pages ?? null,
        versions,
        pending_fields: snap.fields
          .filter((f) => f.signed_version_id === null)
          .map((f) => {
            const o = fieldOut(f, signers);
            return !prep && o.signer_kind === "partner"
              ? { ...o, signer_ref: PARTNER_REF_MASK }
              : o;
          }),
      };
    },

    /** Nội dung PDF của bản gốc (`versionId` null) hoặc một bản (kể cả đã huỷ). null = không thấy (404). */
    async content(
      who: PackWho,
      id: string,
      fileId: string,
      versionId: string | null,
    ): Promise<{ bytes: Uint8Array; name: string } | null> {
      const ref = await d.uow.tenant(who, async (r) => {
        if (!(await r.contractFiles.facts(id))) return null;
        if (versionId) return r.signDoc.outFile(id, fileId, versionId);
        const f = (await r.signDoc.files(id)).find((x) => x.file_id === fileId);
        return f ? { org: f.org, box_id: f.box_id, name: f.name } : null;
      });
      if (!ref) return null;
      const bytes = await d.files.read(ref.org, ref.box_id, d.maxBytes);
      return bytes ? { bytes, name: ref.name } : null;
    },
  };
}
