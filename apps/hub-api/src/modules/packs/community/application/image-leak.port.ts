// COM-C11a · cổng kiểm lộ qua ảnh. Chạy bất đồng bộ sau upload; kết quả do C3/C5 lưu sau. Không bao giờ ném, không chặn:
// lỗi/hết giờ/không có model ⇒ `{status:"unknown"}`.
import type { ImageCheckContext, ImageCheckResult } from "../domain/image-check.rules";

export type ImageInput = {
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  bytes: Uint8Array;
};
export type ImageLeakChecker = {
  check(image: ImageInput, ctx?: ImageCheckContext): Promise<ImageCheckResult>;
};
