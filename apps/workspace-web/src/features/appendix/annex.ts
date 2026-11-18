// CR-182 · R6 «Thêm phụ lục cần ký»: dùng lại API tải HĐ (`kind=appendix` + `parent_id` + `annex=1`), rồi đặt «Cần ký» cho tệp chính (Q14).
import type { ContractDetail, UploadContractResponse } from "@ai/contracts/pack-contracts";
import { api } from "@ai/web-kit/http";

const BASE = "/pack/contracts/contracts";
const at = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

/** Chỉ HĐ gốc (không phải phụ lục) đã duyệt/hiệu lực mới thêm được phụ lục ký sau (máy chủ kiểm lại). */
export const canAddAnnex = (c: Pick<ContractDetail, "kind" | "status">, write: boolean): boolean =>
  write && c.kind === "contract" && c.status === "done";

/** Trả id phụ lục. «Cần ký» đặt không được (công ty chưa bật ký trên tài liệu…) ⇒ bỏ qua: người dùng bật tay ở trang phụ lục. */
export async function createAnnex(parentId: string, file: File): Promise<string> {
  const form = new FormData();
  form.append("kind", "appendix");
  form.append("parent_id", parentId);
  form.append("annex", "1");
  form.append("file", file);
  const up = await api<UploadContractResponse>(BASE, {
    method: "POST",
    rawBody: form as unknown as Blob,
  });
  try {
    const d = await api<ContractDetail>(at(up.id));
    if (d.file)
      await api<void>(`${at(up.id)}/sign-docs/${encodeURIComponent(d.file.id)}`, {
        method: "PATCH",
        body: { needs_sign: true },
      });
  } catch {
    /* giữ phụ lục đã tạo */
  }
  return up.id;
}
