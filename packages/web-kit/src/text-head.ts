// CR-194 · đọc ≤ 1 MB đầu của tệp văn bản, giải mã UTF-8 (byte lỗi ⇒ U+FFFD, không ném lỗi).
export const TEXT_MAX_BYTES = 1024 * 1024;

export async function readTextHead(
  blob: Blob,
  max = TEXT_MAX_BYTES,
): Promise<{ text: string; truncated: boolean }> {
  const truncated = blob.size > max;
  const buf = await blob.slice(0, max).arrayBuffer();
  // stream:true ⇒ ký tự đa byte bị cắt giữa chừng ở cuối không sinh rác; bỏ BOM đầu tệp
  const text = new TextDecoder("utf-8").decode(buf, { stream: truncated });
  return { text: text.replace(/^﻿/, ""), truncated };
}
