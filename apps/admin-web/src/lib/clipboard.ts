// ADM-FR-60, ADM-FR-04 · sao chép mật khẩu tạm; fallback cho ngữ cảnh không an toàn (http ngoài localhost).

function legacyCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

/** `true` nếu đã sao chép được. Không bao giờ ném lỗi và không log nội dung. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // rơi xuống fallback
  }
  return legacyCopy(text);
}
