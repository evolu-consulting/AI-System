// CR-182 · cổng nguồn dữ liệu của màn ký đối tác: màn ký không biết đang gọi API link (adapter ở `api.ts`) hay giả lập trong test.
import type {
  PartnerQuickMethod,
  PartnerSignBody,
  PartnerSignSaveOut,
  PartnerSignViewOut,
} from "@ai/contracts/pack-contracts";

export type PartnerSignView = PartnerSignViewOut & { csrf: string };

export type PartnerSignPort = {
  view(signal?: AbortSignal): Promise<PartnerSignView>;
  quickSignature(csrf: string, method: PartnerQuickMethod, png: string): Promise<void>;
  sign(csrf: string, body: PartnerSignBody): Promise<PartnerSignSaveOut>;
  decline(csrf: string, reason: string): Promise<void>;
  /** PDF của bản mới nhất của tệp (gốc hoặc đã ký) để vẽ lên màn. */
  content(fileId: string, versionId: string | null): Promise<ArrayBuffer>;
  /** Đường dẫn xem/tải bản đã ký (mở thẳng bằng thẻ `a`). */
  signedUrl(fileId: string, versionId: string): string;
};
