// CR-135 · Q5 · «Hồ sơ» của một file HĐ — luật thuần gom dữ liệu ĐÃ CÓ (chi tiết HĐ, hồ sơ duyệt, ký số), không nguồn mới:
// (1) thông tin file, (2) duyệt (dùng lại `recordLines`), (3) ký (phong bì ký số của HĐ/phiên bản đó), (4) tệp là bằng chứng của bước nào.
import type { ESignEnvelopeOut, ESignStateOut } from "@ai/contracts/pack-contracts";
import { esignLabelKey } from "@ai/contracts/pack-contracts";
import type { RecordLine } from "~/features/contract-approval/lib/record-view";

export type MimeKind = "pdf" | "image" | "word" | "excel" | "powerpoint" | "text" | "other";

/** Loại tệp theo MIME, nói bằng ngôn ngữ người dùng (khoá `contracts.frec.kind.*`). */
export function mimeKind(mime: string): MimeKind {
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.includes("wordprocessingml")) return "word";
  if (mime.includes("spreadsheetml")) return "excel";
  if (mime.includes("presentationml")) return "powerpoint";
  if (mime.startsWith("text/") || mime === "application/json" || mime === "application/xml")
    return "text";
  return "other";
}

/** Tên người theo id (danh bạ công ty); không có ⇒ null (UI nói «Không rõ», không in id). */
export function nameOf(
  members: readonly { id: string; name: string }[] | undefined,
  id: string | null | undefined,
): string | null {
  if (!id) return null;
  return members?.find((m) => m.id === id)?.name ?? null;
}

/** Tên các bước duyệt mà tệp (id tệp hub) được gắn làm bằng chứng; không bước nào ⇒ []. Không trùng, giữ thứ tự bước. */
export function evidenceStepsOf(
  fileId: string,
  lines: readonly RecordLine[],
  fallback = "",
): string[] {
  return [
    ...new Set(
      lines
        .filter((l) => l.fileIds.includes(fileId) || l.signatureId === fileId)
        .map((l) => l.stage ?? fallback),
    ),
  ];
}

export type SignSigner = {
  order: number;
  name: string;
  roleKey: string;
  labelKey: string;
  at: string | null;
};
export type SignBlock =
  /** Công ty không ký số (hoặc chưa cấu hình) và HĐ chưa có phong bì: xác nhận bằng bằng chứng duyệt. */
  | { mode: "none" }
  /** Công ty có ký số nhưng HĐ chưa gửi ký. */
  | { mode: "notSent" }
  | {
      mode: "envelope";
      statusKey: string;
      done: boolean;
      demo: boolean;
      provider: string;
      completedAt: string | null;
      reason: string | null;
      signers: SignSigner[];
      hasSignedFile: boolean;
    };

const signerLabel = (s: ESignEnvelopeOut["signers"][number]): string =>
  s.signed_at ? "contracts.esign.signed" : esignLabelKey(s.status ?? "sent");

/** Trạng thái ký của HĐ/phiên bản (phong bì mới nhất): từng bên ký + tải bản đã ký. */
export function signBlock(s: ESignStateOut | undefined): SignBlock {
  const e = s?.envelope ?? null;
  if (!e) return s?.enabled && s.configured ? { mode: "notSent" } : { mode: "none" };
  return {
    mode: "envelope",
    statusKey: esignLabelKey(e.status),
    done: e.status === "completed",
    demo: e.demo,
    provider: e.provider_label,
    completedAt: e.completed_at,
    reason: e.reason,
    signers: [...e.signers]
      .sort((a, b) => a.order - b.order)
      .map((x) => ({
        order: x.order,
        name: x.name,
        roleKey: `contracts.frec.role.${x.role}`,
        labelKey: signerLabel(x),
        at: x.signed_at,
      })),
    hasSignedFile: e.has_signed_file,
  };
}
