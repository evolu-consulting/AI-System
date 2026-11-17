// CR-181 · BR-D2 · Q3/Q4 · bằng chứng Đạt khi công ty bật «ký trên tài liệu» (tách khỏi `gates.service.ts`, trần 400 dòng).
// Thứ tự (soát Opus s9 #3/#4): hỏi gói (CHỈ ĐỌC) → thiếu ký ⇒ 409 SIGN_REQUIRED → kiểm bằng chứng (`evidenceCheck`) → chỉ khi hợp lệ mới chép
// «Chữ ký của tôi» thành tệp `hub.attachments` của người duyệt bằng CHÍNH tx quyết định (rollback chung; không mở kết nối khác khi giữ khoá run).
// Có ≥ 1 tệp cần ký và đã ký đủ ⇒ bản đã ký là chứng cứ chữ ký; không có tệp cần ký ⇒ luật cũ CR-170 (ý kiến + chữ ký/tệp, chữ ký tự gắn).
import { createHash } from "node:crypto";
import { ATTACH_MAX_BYTES, type ReviewDecisionRequest } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { insertAttachment, storageKey } from "../../attachments/public";
import { signaturesRepo } from "../../signatures/public";
import { claimError } from "../core/errors";
import type { ProcessDeps } from "../core/ports";
import { evidenceCheck } from "./gate.rules";
import { evidenceModeOf } from "./gates.helpers";

type Run = Parameters<typeof evidenceModeOf>[0];
type Png = { png: Uint8Array };

/** Kiểm bằng chứng của quyết định (+ BR-D2) và trả quyết định đã gắn chữ ký máy chủ (Q4). Ném 409/422 TRƯỚC mọi câu ghi. */
export async function signEvidence(
  d: Pick<ProcessDeps, "packBeforePass" | "storage">,
  tx: Tx,
  a: { run: Run; idx: number; actor: string; b: ReviewDecisionRequest },
): Promise<ReviewDecisionRequest> {
  const { run, idx, actor, b } = a;
  const mode = evidenceModeOf(run, idx);
  const pk = run.packKey;
  const ask = b.result === "pass" && mode === "opinion_plus" && pk && d.packBeforePass;
  const sign = ask
    ? await d.packBeforePass?.({ tenantId: run.tenantId, packKey: pk, runId: run.id, actor })
    : null;
  if (sign && sign.missing.length > 0) throw claimError("SIGN_REQUIRED", { files: sign.missing });
  const want = !!sign?.companyOn && !!b.evidence && !b.evidence.signature_attachment_id;
  const mine = want && d.storage ? await activeSignature(tx, run.tenantId, actor) : null;
  const ev = {
    result: b.result,
    mode,
    evidence:
      mine && b.evidence ? { ...b.evidence, signature_attachment_id: "server" } : b.evidence,
    signedOnDoc: sign?.onDoc === true,
  };
  if (evidenceCheck(ev) !== "ok") throw claimError("EVIDENCE_REQUIRED");
  if (!mine || !b.evidence || !d.storage) return b;
  const sid = await attachSignature(tx, d.storage, { tenantId: run.tenantId, userId: actor }, mine);
  return { ...b, evidence: { ...b.evidence, signature_attachment_id: sid } };
}

/** Chữ ký đang dùng của người duyệt (đọc trong tx đang mở). */
async function activeSignature(tx: Tx, tenantId: string, userId: string): Promise<Png | null> {
  const r = await signaturesRepo(tx).signatureForStamp(tenantId, userId, "main");
  return r ? { png: new Uint8Array(r.png) } : null;
}

/** Ghi PNG vào kho rồi MỘT câu INSERT hàng của người duyệt trong tx quyết định (rollback ⇒ không hàng; blob mồ côi do vòng dọn kho). */
async function attachSignature(
  tx: Tx,
  storage: NonNullable<ProcessDeps["storage"]>,
  who: { tenantId: string; userId: string },
  s: Png,
): Promise<string> {
  const id = crypto.randomUUID();
  const staged = await storage.stage(
    storageKey(who.tenantId, id),
    new Blob([s.png], { type: "image/png" }).stream(),
    { maxBytes: ATTACH_MAX_BYTES },
  );
  await staged.commit();
  await insertAttachment(tx, {
    id,
    tenantId: who.tenantId,
    userId: who.userId,
    origin: "upload",
    jobId: null,
    conversationId: null,
    flowId: null,
    filename: "chu-ky.png",
    safeName: "chu-ky.png",
    mime: "image/png",
    size: s.png.byteLength,
    sha256: createHash("sha256").update(s.png).digest("hex"),
    fileboxFileId: staged.fileId ?? null,
    fileboxVersionId: staged.versionId ?? null,
  });
  return id;
}
