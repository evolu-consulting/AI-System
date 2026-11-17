// CR-181 · s9 · cổng gắn muộn của «ký trên tài liệu» theo lượt chạy. Gói không import module hub (luật pack-no-hub-modules-any-layer) ⇒
// lớp lắp ráp `packs/packs.sign-doc.ts` gắn phần đọc thiết lập công ty / bước đang mở; `intake.mount.ts` gắn bắn `esign.completed`;
// `submit.usecase.ts` gắn «stage của quy trình sẽ chạy». Vắng ⇒ hành vi cũ (không chặn, không tự xong bước).
import type { PackWho } from "../../kit/public";
import type { OndocSigner } from "../domain/sign-turn.rules";

export type SignSubmitBlock = "sign_no_files" | "sign_missing_fields";
export const signFlowHooks: {
  /** Stage của các quy trình mà Gửi duyệt BÂY GIỜ sẽ chạy (CÙNG bộ chọn của lệnh Gửi). */
  plannedStages?: (who: PackWho, contractId: string) => Promise<unknown[][]>;
  /** BR-T2 / BR-C3 · lý do chặn Gửi duyệt theo stage sẽ chạy (null ⇒ không chặn). */
  submitCheck?: (
    who: PackWho,
    contractId: string,
    stages: readonly unknown[][],
  ) => Promise<SignSubmitBlock | null>;
  /** Bước Ký `ondoc` vừa mở: các ô Bên A đã ký đủ (Q8) ⇒ bắn `esign.completed`. Không ném. */
  ondocOpened?: (
    tenantId: string,
    contractId: string,
    signers: readonly OndocSigner[],
  ) => Promise<void>;
  /** Thả bước chờ `esign.completed` của HĐ (cùng đường ký số / tải lên). */
  completed?: (tenantId: string, contractId: string, data: Record<string, string>) => Promise<void>;
  /** BR-D2 · trước khi Đạt bước duyệt có bằng chứng (`runId` = lượt chạy engine). null ⇒ không áp. */
  beforePass?: (e: {
    tenantId: string;
    runId: string;
    actor: string;
    wantSignature: boolean;
  }) => Promise<{
    onDoc: boolean;
    missing: string[];
    signatureAttachmentId?: string | null;
  } | null>;
} = {};
