// CR-118 · COM-FR-37 · tải lần lượt các tệp chọn lên FileBox của community; trả media mới + khoá i18n các thông báo (quá hạn mức, lỗi upload).
import type { MediaItem } from "@ai/contracts/community";
import { canAddMedia } from "../domain/compose";
import { mediaItemOf, type UploadNotice, uploadNotice } from "../domain/media";
import { numLocale } from "../i18n";
import type { CommunityApi } from "./ports";

export async function uploadFiles(
  api: Pick<CommunityApi, "uploadFile">,
  files: File[],
  media: MediaItem[],
): Promise<{ media: MediaItem[]; notices: UploadNotice[] }> {
  const notices: UploadNotice[] = [];
  let out = media;
  for (const f of files) {
    try {
      const item = mediaItemOf(await api.uploadFile(f));
      if (canAddMedia(out, item.kind)) out = [...out, item];
      else
        notices.push({
          key:
            item.kind === "image" ? "community.composer.maxImages" : "community.composer.maxFiles",
        });
    } catch (err) {
      notices.push(
        uploadNotice(err as { status?: number; code?: string; details?: unknown }, numLocale()),
      );
    }
  }
  return { media: out, notices };
}
