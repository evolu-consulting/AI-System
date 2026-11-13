// CR-127 · U4 · E4/E4b/K5: hồ sơ duyệt (`GET /contracts/:id/approval-record`, tải tệp bằng chứng) + «Đã đổi so với lần trước».
import type { ApprovalRecord, ChangesSinceLast } from "@ai/contracts/pack-contracts";
import { api, apiResponse } from "@ai/web-kit/http";

const BASE = "/pack/contracts/contracts";
const enc = encodeURIComponent;
export const recordKey = (id: string) => ["contract-approval-record", id] as const;
export const changesKey = (id: string) => ["contract-changes-since-last", id] as const;

export const fetchApprovalRecord = (id: string, signal?: AbortSignal) =>
  api<ApprovalRecord>(`${BASE}/${enc(id)}/approval-record`, { signal });
export const fetchChangesSinceLast = (id: string, signal?: AbortSignal) =>
  api<ChangesSinceLast>(`${BASE}/${enc(id)}/changes-since-last`, { signal });

/** CR-144 · nội dung tệp/chữ ký của một bằng chứng để XEM trong hộp (`?inline=1`; kèm Bearer; người không đọc được ⇒ 404). */
export async function fetchEvidenceBlob(
  id: string,
  evidenceId: string,
  fileId: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const res = await apiResponse(
    `${BASE}/${enc(id)}/approval-record/evidence/${enc(evidenceId)}/files/${enc(fileId)}?inline=1`,
    { signal },
  );
  return res.blob();
}

/** U4b-PDF · «Tải PDF» hồ sơ duyệt (cùng quyền xem hồ sơ; kèm Bearer ⇒ blob ⇒ lưu tệp). */
export async function downloadRecordPdf(id: string): Promise<void> {
  const res = await apiResponse(`${BASE}/${enc(id)}/approval-record.pdf`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `ho-so-duyet-${id}.pdf`;
  document.body.append(a);
  try {
    a.click();
  } finally {
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
