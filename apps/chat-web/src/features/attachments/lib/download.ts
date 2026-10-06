// X1-R07 · tải tệp qua fetch có Authorization → blob → object URL → `<a download>` tạm → thu hồi URL.
import { fetchAttachmentContent } from "../api";

export async function downloadAttachment(id: string, filename: string): Promise<void> {
  const blob = await fetchAttachmentContent(id);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.append(a);
  try {
    a.click();
  } finally {
    a.remove();
    URL.revokeObjectURL(url);
  }
}

/** "1.5 KB" / "20 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
