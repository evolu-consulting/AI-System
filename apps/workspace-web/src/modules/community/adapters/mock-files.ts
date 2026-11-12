// CR-118 · COM-FR-37 · tệp đính kèm ở chế độ mẫu (dev/e2e không backend): giữ object URL theo id trong phiên.
import type { CommunityApi } from "../application/ports";

export function fileMock(): Pick<CommunityApi, "uploadFile" | "downloadFile" | "fileObjectUrl"> {
  const urls = new Map<string, string>();
  return {
    uploadFile: async (file) => {
      const id = crypto.randomUUID();
      urls.set(id, URL.createObjectURL(file));
      return {
        id,
        name: file.name,
        mime: file.type || "application/octet-stream",
        size: file.size,
      };
    },
    downloadFile: async (fileId) => {
      const url = urls.get(fileId);
      if (url) window.open(url, "_blank", "noopener");
    },
    fileObjectUrl: async (fileId) => {
      const url = urls.get(fileId);
      if (!url) throw new Error("not found");
      return url;
    },
  };
}
