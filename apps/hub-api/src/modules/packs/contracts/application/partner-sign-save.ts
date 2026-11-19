// CR-182 · đợt 2 · «Lưu chữ ký» của đối tác (lớp 2, không SQL): đọc dữ kiện → in chữ ký nhanh của link (máy chủ, không nhận ảnh) → lưu tệp ra FileBox
// (NGOÀI tx) → MỘT tx: khoá `sign_docs`, kiểm bản mới nhất không đổi, ghi bản (signed_by NULL + signer_contact_id) + dấu + đánh dấu ô Bên B; đủ ô Bên B ⇒
// chốt link trong CÙNG tx (CAS) + chuông cho người tải lên. Thứ tự lỗi: 404 tệp → 403 ô không phải của đối tác → 422 dấu sai → 400 chưa có chữ ký nhanh
// (kiểm trước, ở `sign`) → 422 in → 409 bản đã đổi / link đã đóng.
import type { PartnerSignBody, PartnerSignSaveOut } from "@ai/contracts/pack-contracts";
import { PARTNER_SIGN_ERRORS as E } from "@ai/contracts/pack-contracts";
import type { PackWho, SignLinkFail, SignLinkResult } from "../../kit/public";
import { partnerLabel, partnerMarksIssue, partnerOpenFields } from "../domain/partner-sign.rules";
import { isPdfFile, signedOnLine } from "../domain/sign.rules";
import { SignError } from "../domain/sign-error";
import type { PartnerSignDeps, PartnerSignRepos } from "./partner-sign.deps";
import type { ContactRow, LinkRow } from "./partner-sign.repo.port";
import type { SignFileRef, SignVersionRowP } from "./sign-doc.ports";

const fail = (status: SignLinkFail["status"], code: string): SignLinkFail => ({
  ok: false,
  status,
  code,
});
type Out = { bytes: Uint8Array; sha256: string; pages: number };
type Snap = {
  file: SignFileRef;
  lastV: SignVersionRowP | null;
  base: { org: string; box_id: string } | null;
  c: { title: string; created_by: string; company_name: string };
  contact: ContactRow | null;
};

/** Dữ kiện + kiểm dấu (404/403/422). Bốn câu cố định, không theo số dấu. */
async function load(
  d: PartnerSignDeps,
  l: LinkRow,
  body: PartnerSignBody,
): Promise<Snap | SignLinkFail> {
  const s = await d.uow.system(l.tenant_id, async (r: PartnerSignRepos) => {
    const [files, docs, fields, latest] = await Promise.all([
      r.signDoc.files(l.contract_id),
      r.docs.listByContract(l.contract_id),
      r.fields.listByContract(l.contract_id),
      r.versions.latestByContract(l.contract_id),
    ]);
    const file = files.find((x) => x.file_id === body.file_id);
    const lastV = latest.find((x) => x.file_id === body.file_id) ?? null;
    return {
      file,
      need: docs.find((x) => x.file_id === body.file_id)?.needs_sign === true,
      fields,
      lastV,
      base: lastV ? await r.signDoc.outFileById(lastV.out_file_id) : null,
      c: await r.partnerSign.contract(l.contract_id),
      contact: await r.partnerSign.contact(l.contact_id, l.contract_id),
    };
  });
  if (!s.file || !s.need || !s.c) return fail(404, E.fileNotFound);
  const bad = partnerMarksIssue(body.marks, s.fields, body.file_id);
  if (bad) return bad === "forbidden" ? fail(403, E.fieldForbidden) : fail(422, E.markInvalid);
  return { file: s.file, lastV: s.lastV, base: s.base, c: s.c, contact: s.contact };
}

/** In chữ ký nhanh lên bản mới nhất (mạng ngoài tx). */
async function render(
  d: PartnerSignDeps,
  l: LinkRow,
  body: PartnerSignBody,
  s: Snap,
  png: Uint8Array,
  text: string | undefined,
  signedOn: string,
): Promise<Out | SignLinkFail> {
  const ref = s.base ?? s.file;
  const pdf = await d.files.read(ref.org, ref.box_id, d.maxBytes);
  if (!pdf || !isPdfFile(s.file)) return fail(422, "SIGN_PDF_INVALID");
  const who: PackWho = { tenantId: l.tenant_id, userId: l.contact_id };
  try {
    return await d.produce({
      pdf,
      kind: "internal",
      ink: "blue",
      who,
      marks: body.marks.map((m) => ({
        png,
        parts: m.parts,
        signedOn,
        ...(text ? { caption: text } : {}),
      })),
    });
  } catch (e) {
    if (e instanceof SignError) return fail(422, e.code);
    throw e;
  }
}

/** Đủ ô Bên B: chốt link (CAS, cùng tx) + chuông cho người tải lên. false ⇒ link vừa bị thu hồi/đóng. */
async function closeLink(
  r: PartnerSignRepos,
  a: { l: LinkRow; th: string; s: Snap; label: string },
): Promise<boolean> {
  if ((await r.partnerSign.finish(a.th, "sign", null)) !== "ok") return false;
  await r.notify.enqueue([
    {
      user_id: a.s.c.created_by,
      kind: "contract.partner_signed",
      title: `Đối tác đã ký xong: ${a.s.c.title}`.slice(0, 200),
      body: `${a.label} đã ký đủ — hợp đồng đã ký.`,
      link: `/contracts/${a.l.contract_id}`,
      dedup_key: `partner-signed:${a.l.link_id}`,
    },
  ]);
  return true;
}

type Put = { org: string; boxId: string; versionId: string; name: string };

/** Ném TRONG tx để ROLLBACK (không commit bản trỏ vào tệp sắp bị xoá); bắt ở `partnerSignSave`. */
class PartnerAbort extends Error {
  constructor(readonly fail: SignLinkFail) {
    super(fail.code);
  }
}
const abort = (status: SignLinkFail["status"], code: string): never => {
  throw new PartnerAbort(fail(status, code));
};
/** Tối đa số bản đối tác Lưu trên một HĐ (chống dồn bản bằng dấu tự đặt thêm). */
export const PARTNER_VERSION_CAP = 40;

/** Đầu tx: khoá link (FOR UPDATE) ⇒ Lưu song song nối đuôi, «Trả lại» đợi; link không còn mở ⇒ 409/410; khoá tệp; bản mới nhất không đổi; trần bản. */
async function guardTx(
  r: PartnerSignRepos,
  a: { l: LinkRow; th: string; body: PartnerSignBody; s: Snap },
): Promise<void> {
  const st = await r.partnerSign.lockState(a.th);
  if (st === "invalid") abort(404, "NOT_FOUND");
  if (st === "signed" || st === "declined") abort(409, E.closed);
  if (st !== "open") abort(410, E.gone);
  if (!(await r.signDoc.lockDoc(a.l.contract_id, a.body.file_id))) abort(404, E.fileNotFound);
  const cur = await r.versions.latest(a.l.contract_id, a.body.file_id);
  if ((cur?.id ?? null) !== (a.s.lastV?.id ?? null)) abort(409, E.stale);
  if ((await r.partnerSign.versionCount(a.l.contract_id, a.l.contact_id)) >= PARTNER_VERSION_CAP)
    abort(409, "SIGN_LINK_LIMIT");
}

/** MỘT tx: bản + dấu + ô + (đủ ô) chốt link + chuông. Mọi lỗi nghiệp vụ ⇒ THROW (rollback). */
async function persist(
  d: PartnerSignDeps,
  a: {
    l: LinkRow;
    th: string;
    body: PartnerSignBody;
    s: Snap;
    out: Out;
    put: Put;
    quickId: string;
    label: string;
    text: string | undefined;
    runId: string;
  },
): Promise<PartnerSignSaveOut> {
  const { l, th, body, s, out, put, label } = a;
  const fieldIds = body.marks.flatMap((m) => (m.field_id ? [m.field_id] : []));
  return d.uow.system(l.tenant_id, async (r: PartnerSignRepos) => {
    await guardTx(r, { l, th, body, s });
    const rowId = d.newId();
    await r.signDoc.insertOutFile({
      id: rowId,
      org: put.org,
      boxId: put.boxId,
      versionId: put.versionId,
      name: put.name,
      size: out.bytes.byteLength,
      by: s.c.created_by,
    });
    const v = await r.versions.add({
      id: d.newId(),
      contractId: l.contract_id,
      fileId: body.file_id,
      outFileId: rowId,
      sha256: out.sha256,
      signedBy: null,
      signerContactId: l.contact_id,
      signerLabel: label,
      kind: "internal",
      runId: a.runId, // BR-L2 · cùng lượt với bản của bên A ⇒ «Trả lại» void được
      marks: body.marks.map((m) => ({
        fieldId: m.field_id ?? null,
        placement: m.placement,
        parts: m.parts,
        userSignatureId: null,
        quickSignatureId: a.quickId,
        caption: a.text ?? null,
      })),
    });
    if (!v) return abort(404, E.fileNotFound);
    const want = new Set(fieldIds).size;
    if (want > 0 && (await r.fields.markSigned(l.contract_id, fieldIds, null, v.id)) !== want)
      abort(409, E.stale);
    const left = partnerOpenFields(await r.fields.listByContract(l.contract_id));
    if (left === 0 && !(await closeLink(r, { l, th, s, label }))) abort(409, E.closed);
    return { version_id: v.id, seq: v.seq, open_fields_left: left, completed: left === 0 };
  });
}

/** Điều phối: kiểm → in → lưu tệp → tx; lỗi/huỷ ⇒ gỡ tệp vừa ghi FileBox. `done` chạy SAU COMMIT khi đủ ô. */
export async function partnerSignSave(
  d: PartnerSignDeps,
  a: {
    l: LinkRow;
    th: string;
    body: PartnerSignBody;
    quick: { id: string; png: Uint8Array };
    done: (s: { title: string; company: string; contact: ContactRow | null }) => Promise<void>;
  },
): Promise<SignLinkResult<PartnerSignSaveOut>> {
  const { l, th, body, quick } = a;
  const s = await load(d, l, body);
  if ("ok" in s) return s;
  const label = partnerLabel(s.contact?.name ?? null, s.contact?.partner_name ?? null);
  // BR-188-2 · đối tác: dòng dưới = tên người ký/đối tác; «Ký ngày …» LUÔN in (giờ VN, giờ máy chủ).
  const text = label.trim() || undefined;
  const signedOn = signedOnLine(d.now());
  // BR-L2 · bước Ký còn mở (Bên A đủ, chưa đóng) ⇒ mới cho Lưu; `run_id` của bản = lượt của bước.
  // `run_id` lấy TRƯỚC khoá link (kết nối khác, ngoài tx): nếu «Trả lại» chen vào giữa thì `guardTx` thấy link đã thu hồi ⇒ 410 và rollback,
  // nên bản mang `run_id` cũ không bao giờ được ghi.
  const step = await d.counts(l.tenant_id, l.contract_id);
  if (!step?.a_done) return fail(409, E.closed);
  const out = await render(d, l, body, s, quick.png, text, signedOn);
  if ("ok" in out) return out;
  const org = d.orgOf(l.tenant_id);
  const name = `${s.file.name.replace(/\.pdf$/i, "")} (đã ký).pdf`;
  const up = await d.files.put(org, name, out.bytes);
  const put: Put = { org, boxId: up.fileId, versionId: up.versionId, name };
  const drop = () => d.files.remove(org, up.fileId).catch(() => undefined);
  try {
    const data = await persist(d, {
      l,
      th,
      body,
      s,
      out,
      put,
      quickId: quick.id,
      label,
      text,
      runId: step.run_id,
    });
    if (data.completed)
      await a.done({ title: s.c.title, company: s.c.company_name, contact: s.contact });
    return { ok: true, data };
  } catch (e) {
    await drop(); // tx đã ROLLBACK (không còn hàng trỏ vào tệp)
    if (e instanceof PartnerAbort) return e.fail;
    throw e;
  }
}
