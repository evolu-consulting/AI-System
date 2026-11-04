// CR-118 · COM-FR-37 · tải lần lượt các tệp chọn lên FileBox của community; trả media mới + khoá i18n các thông báo (quá hạn mức, lỗi upload).
import type { MediaItem } from "@ai/contracts/community";
import { canAddMedia } from "../domain/compose";
import { mediaItemOf, uploadErrorKey } from "../domain/media";
import type { CommunityApi } from "./ports";

export async function uploadFiles(
  api: Pick<CommunityApi, "uploadFile">,
  files: File[],
  media: MediaItem[],
): Promise<{ media: MediaItem[]; notices: string[] }> {
  const notices: string[] = [];
  let out = media;
  for (const f of files) {
    try {
      const item = mediaItemOf(await api.uploadFile(f));
      if (canAddMedia(out, item.kind)) out = [...out, item];
      else
        notices.push(
          item.kind === "image" ? "community.composer.maxImages" : "community.composer.maxFiles",
        );
    } catch (err) {
      notices.push(uploadErrorKey((err as { status?: number }).status));
    }
  }
  return { media: out, notices };
}
