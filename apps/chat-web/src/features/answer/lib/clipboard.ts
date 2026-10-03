// C1 FE · F12 · sao chép an toàn: không ném lỗi khi thiếu quyền / không có Clipboard API.
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
