// CR-181 · s8 phần A · «Ký trên tài liệu» phía HĐ — use case (lớp 2, không SQL): bật/tắt «Cần ký» (BR-T1, Q13), người ký (Q2), đặt chỗ ký
// (BR-C1/C2), phiên chuẩn bị/ký/xem (`sessionMode`). Số câu SQL cố định: session = facts + (tệp, đối tác, cờ, chỗ ký, bản) ≤ 6; PATCH/PUT = 2 tx
// nhỏ (kiểm → đọc tệp ngoài tx → ghi). Nội dung tệp đọc từ FileBox NGOÀI tx.
import type {
  SignFieldOut,
  SignFileOut,
  SignReadinessOut,
  SignSessionOut,
  SignSignerOut,
} from "@ai/contracts/pack-contracts";
import type { PackUow, PackWho } from "../../kit/public";
import { type ContractFileFacts, isContractFilesLocked } from "../domain/contract-files.rules";
import {
  canPrepSign,
  defaultNeedsSign,
  type FieldIn,
  fieldsIssue,
  isPdfFile,
  labelOf,
  maskPartnerRef,
  needsSignIssue,
  normalizeFields,
  PARTNER_REF_MASK,
  type PdfProbe,
  type SignerEntry,
  sessionMode,
  signerKey,
  signReadiness,
  uploaderOf,
} from "../domain/sign.rules";
import type { SignTurn, SignTurnPort } from "../domain/sign-turn.port";
import type {
  PartnerSigner,
  SignDocRepos,
  SignDocRowP,
  SignFieldRowP,
  SignFileRef,
  SignVersionRowP,
} from "./sign-doc.ports";

export type { SignDocRepos } from "./sign-doc.ports";

/** Người ký công ty của bước Ký (Q2): người cụ thể hoặc nhóm. `mine` (tuỳ chọn) = người gọi thuộc nhóm đó. */
export type CompanySigner = { kind: "user" | "group"; id: string; name: string; mine?: boolean };

export type SignDocFailKind =
  | "not_found"
  | "forbidden"
  | "locked"
  | "off"
  | "not_needed"
  | "issue"
  /** Q12 · chữ ký số chưa bật (409 `DIGITAL_SIGN_NOT_ENABLED`). */
  | "digital"
  /** K5 · người ký chưa có chữ ký (409 `SIGNATURE_MISSING`). */
  | "signature_missing"
  /** L1 · có người Lưu bản mới trong lúc này (409 `SIGN_VERSION_STALE`) — mở lại để ký trên bản mới nhất. */
  | "stale";
export class SignDocFail extends Error {
  constructor(
    readonly kind: SignDocFailKind,
    /** Mã nghiệp vụ khi `kind = issue` (422). */
    readonly code = "",
  ) {
    super(code ? `${kind}:${code}` : kind);
  }
}

export type SignDocUsecases = ReturnType<typeof signDocUsecases>;

export type SignDocDeps = {
  uow: PackUow<SignDocRepos>;
  files: { read(org: string, boxId: string, maxBytes: number): Promise<Uint8Array | null> };
  maxBytes: number;
  /** Đếm trang / nhận ra tệp có mật khẩu (adapter `sign-pdf-probe`). */
  probePdf: (bytes: Uint8Array) => Promise<PdfProbe>;
  companySigners: (who: PackWho, contractId: string) => Promise<CompanySigner[]>;
  /** Thiết lập công ty: «Ký trên tài liệu» đang bật (Q5). */
  onDocEnabled: (who: PackWho) => Promise<boolean>;
  turn: SignTurnPort;
  newId: () => string;
};

const DIGITAL_OFF = "Công ty chưa bật chữ ký số";
const contentUrl = (id: string, fileId: string, versionId: string | null): string =>
  versionId
    ? `/contracts/${id}/sign-docs/${fileId}/versions/${versionId}/content`
    : `/contracts/${id}/sign-docs/${fileId}/content`;

/** Danh sách người ký (Q2): Bên A = từng người / «Đại diện <nhóm>»; Bên B = liên hệ đầu tiên có email. */
export function buildSigners(
  company: readonly CompanySigner[],
  partner: PartnerSigner | null,
  me: string,
): SignSignerOut[] {
  const a: SignSignerOut[] = company.map((c) =>
    c.kind === "user"
      ? { side: "A", kind: "user", ref: c.id, name: c.name, mine: c.id === me }
      : { side: "A", kind: "group", ref: c.id, name: `Đại diện ${c.name}`, mine: c.mine === true },
  );
  const email = partner?.email?.trim().toLowerCase();
  const b: SignSignerOut[] = email
    ? [
        {
          side: "B",
          kind: "partner",
          ref: email,
          name: partner?.name?.trim() || partner?.partner_name?.trim() || email,
          mine: false,
        },
      ]
    : [];
  return [...a, ...b];
}

/** X2 · chỗ ký đối tác: che email ở `signer_ref`. */
const maskField = (f: SignFieldOut): SignFieldOut =>
  f.signer_kind === "partner" ? { ...f, signer_ref: PARTNER_REF_MASK } : f;

export const fieldOut = (f: SignFieldRowP, signers: readonly SignerEntry[]): SignFieldOut => ({
  id: f.id,
  side: f.side,
  signer_kind: f.signer_kind,
  signer_ref: f.signer_ref,
  label: f.label,
  parts: f.parts,
  mine: signers.some(
    (s) => s.mine && signerKey(s.kind, s.ref) === signerKey(f.signer_kind, f.signer_ref),
  ),
  signed: f.signed_version_id !== null,
  signed_by: f.signed_by,
  signed_version_id: f.signed_version_id,
});

type Loaded = { facts: ContractFileFacts; files: SignFileRef[]; file: SignFileRef };

export function signDocUsecases(d: SignDocDeps) {
  /** Kiểm trong tx: HĐ + tệp thấy được (404), đúng người tải lên (403), công ty bật (409), HĐ chưa khoá (409). */
  async function gate(
    r: SignDocRepos,
    who: PackWho,
    id: string,
    fileId: string,
    enabled: boolean,
  ): Promise<Loaded> {
    const facts = await r.contractFiles.facts(id);
    if (!facts) throw new SignDocFail("not_found");
    const files = await r.signDoc.files(id);
    const file = files.find((f) => f.file_id === fileId);
    if (!file) throw new SignDocFail("not_found");
    if (uploaderOf(file, facts.created_by) !== who.userId) throw new SignDocFail("forbidden");
    if (!enabled) throw new SignDocFail("off");
    if (isContractFilesLocked(facts)) throw new SignDocFail("locked");
    return { facts, files, file };
  }
  /** Đọc + kiểm PDF (ngoài tx). Không đọc được tệp ⇒ coi là hỏng. */
  async function probe(file: SignFileRef): Promise<PdfProbe | null> {
    if (!isPdfFile(file)) return null;
    const bytes = await d.files.read(file.org, file.box_id, d.maxBytes);
    if (!bytes) return null;
    return d.probePdf(bytes);
  }
  const issueOf = (file: SignFileRef, p: PdfProbe | null): void => {
    const code = needsSignIssue(isPdfFile(file), p);
    if (code) throw new SignDocFail("issue", code);
  };

  return {
    /** BR-T1 · bật/tắt «Cần ký» của một tệp. Tắt ⇒ xoá chỗ ký chưa ký của tệp đó. */
    async setNeedsSign(who: PackWho, id: string, fileId: string, needsSign: boolean) {
      const enabled = await d.onDocEnabled(who);
      const first = await d.uow.tenant(who, (r) => gate(r, who, id, fileId, enabled));
      let pages: number | null = null;
      if (needsSign) {
        const p = await probe(first.file);
        issueOf(first.file, p);
        pages = p?.ok ? p.pages : null;
      }
      const row = await d.uow.tenant(who, async (r) => {
        await gate(r, who, id, fileId, enabled);
        const set = await r.docs.set(id, fileId, needsSign, pages, who.userId);
        if (!set) throw new SignDocFail("not_found");
        if (!needsSign) await r.fields.replaceForFile(id, fileId, [], who.userId);
        return set;
      });
      return { file_id: fileId, needs_sign: row.needs_sign, pages: row.pages };
    },

    /** BR-C2 · đặt TOÀN BỘ chỗ ký chưa ký của tệp (chỗ đã ký giữ nguyên). */
    async putFields(who: PackWho, id: string, fileId: string, input: readonly FieldIn[]) {
      const enabled = await d.onDocEnabled(who);
      const first = await d.uow.tenant(who, async (r) => ({
        ...(await gate(r, who, id, fileId, enabled)),
        doc: await r.docs.get(id, fileId),
        partner: await r.signDoc.partner(id),
      }));
      const needs = first.doc
        ? first.doc.needs_sign
        : defaultNeedsSign({ is_main: first.file.is_main, is_pdf: isPdfFile(first.file) }, enabled);
      if (!needs) throw new SignDocFail("not_needed");
      const signers = buildSigners(await d.companySigners(who, id), first.partner, who.userId);
      let pages = first.doc?.pages ?? null;
      if (pages === null) {
        const p = await probe(first.file);
        issueOf(first.file, p);
        pages = p?.ok ? p.pages : null;
      }
      const out = await d.uow.tenant(who, async (r) => {
        await gate(r, who, id, fileId, enabled);
        const cur = await r.docs.get(id, fileId);
        if (cur && !cur.needs_sign) throw new SignDocFail("not_needed"); // đã tắt giữa hai tx
        if (!first.doc || first.doc.pages === null)
          await r.docs.set(id, fileId, true, pages, who.userId);
        const existing = await r.fields.listByFile(id, fileId);
        const norm = normalizeFields(
          input.map((f) => ({ ...f, signer_ref: f.signer_ref.toLowerCase() })),
          existing.map((e) => ({ id: e.id, signed: e.signed_version_id !== null })),
          d.newId,
        );
        const bad = fieldsIssue(norm, signers, pages);
        if (bad) throw new SignDocFail("issue", bad);
        await r.fields.replaceForFile(
          id,
          fileId,
          norm.map((f) => ({
            id: f.id,
            side: f.side,
            signerKind: f.signer_kind,
            signerRef: f.signer_ref,
            label: labelOf(f.signer_kind, f.signer_ref, signers),
            parts: f.parts,
          })),
          who.userId,
        );
        return r.fields.listByFile(id, fileId);
      });
      return { fields: out.map((f) => fieldOut(f, signers)) };
    },

    /** Người ký để làm khay chuẩn bị chỗ ký. null = HĐ không thấy (404). */
    async signers(who: PackWho, id: string) {
      const enabled = await d.onDocEnabled(who);
      const snap = await d.uow.tenant(who, async (r) => {
        const facts = await r.contractFiles.facts(id);
        if (!facts) return null;
        return { facts, files: await r.signDoc.files(id), partner: await r.signDoc.partner(id) };
      });
      if (!snap) return null;
      const company = await d.companySigners(who, id);
      // X2 · email liên hệ đối tác chỉ cho người đang chuẩn bị chỗ ký; người khác chỉ thấy tên.
      const prep =
        enabled &&
        snap.files.some((f) =>
          canPrepSign(who.userId, uploaderOf(f, snap.facts.created_by), snap.facts),
        );
      return {
        enabled,
        signers: buildSigners(company, snap.partner, who.userId).map((x) =>
          maskPartnerRef(x, prep),
        ),
      };
    },

    /** Phiên màn ký: tệp + bản mới nhất + chỗ ký + người ký + chế độ. null = HĐ không thấy (404). */
    async session(who: PackWho, id: string): Promise<SignSessionOut | null> {
      const enabled = await d.onDocEnabled(who);
      const kinds = { internal: true, digital: { enabled: false, reason: DIGITAL_OFF } } as const;
      const snap = await d.uow.tenant(who, async (r) => {
        const facts = await r.contractFiles.facts(id);
        if (!facts) return null;
        if (!enabled) return { facts, off: true as const };
        const files = await r.signDoc.files(id);
        const partner = await r.signDoc.partner(id);
        const docs = await r.docs.listByContract(id);
        const fields = await r.fields.listByContract(id);
        const latest = await r.versions.latestByContract(id);
        return { facts, off: false as const, files, partner, docs, fields, latest };
      });
      if (!snap) return null;
      if (snap.off)
        return {
          enabled: false,
          mode: "view",
          locked: isContractFilesLocked(snap.facts),
          files: [],
          signers: [],
          readiness: { ready: true, missing: [] },
          turn: { allowed: false },
          kinds,
        };
      const company = await d.companySigners(who, id);
      const turn: SignTurn = await d.turn.turnFor(who, id, who.userId);
      const signers = buildSigners(company, snap.partner, who.userId);
      const docBy = new Map<string, SignDocRowP>(snap.docs.map((x) => [x.file_id, x]));
      const latestBy = new Map<string, SignVersionRowP>(snap.latest.map((v) => [v.file_id, v]));
      const files: SignFileOut[] = snap.files.map((f) => {
        const doc = docBy.get(f.file_id);
        const isPdf = isPdfFile(f);
        const uploader = uploaderOf(f, snap.facts.created_by);
        const v = latestBy.get(f.file_id);
        const needs = doc
          ? doc.needs_sign
          : defaultNeedsSign({ is_main: f.is_main, is_pdf: isPdf }, true);
        return {
          file_id: f.file_id,
          name: f.name,
          is_main: f.is_main,
          is_pdf: isPdf,
          uploader_id: uploader,
          can_prep: canPrepSign(who.userId, uploader, snap.facts),
          pages: doc?.pages ?? null,
          needs_sign: needs,
          latest: {
            version_id: v?.id ?? null,
            seq: v?.seq ?? 0,
            url: contentUrl(id, f.file_id, v?.id ?? null),
          },
          fields: needs
            ? snap.fields.filter((x) => x.file_id === f.file_id).map((x) => fieldOut(x, signers))
            : [],
        };
      });
      const readiness: SignReadinessOut = signReadiness(
        files,
        files.flatMap((f) => f.fields.map((x) => ({ ...x, file_id: f.file_id }))),
        signers,
      );
      const mode = sessionMode(
        files.some((f) => f.can_prep),
        turn.allowed,
      );
      const prep = mode === "prep";
      return {
        enabled: true,
        mode,
        locked: isContractFilesLocked(snap.facts),
        files: prep
          ? files
          : files.map((f) => ({ ...f, fields: f.fields.map((x) => maskField(x)) })),
        signers: signers.map((x) => maskPartnerRef(x, prep)),
        readiness,
        turn,
        kinds,
      };
    },
  };
}
