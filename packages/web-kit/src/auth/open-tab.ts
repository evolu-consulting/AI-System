// CR-143 · mở app khác ở TAB MỚI sau khi xin mã SSO (async). Mở tab rỗng ngay lúc bấm (đồng bộ ⇒ trình duyệt không chặn popup),
// có URL thì điều hướng tab đó; bị chặn (null) ⇒ rơi về điều hướng tab hiện tại. Không có URL ⇒ đóng tab rỗng, trả false.
export async function openInNewTab(
  resolve: () => Promise<string | null | undefined>,
  fallbackUrl?: string,
): Promise<boolean> {
  const w = window.open("", "_blank");
  const url = (await resolve().catch(() => null)) ?? fallbackUrl ?? null;
  if (!url) {
    w?.close();
    return false;
  }
  if (w) {
    w.opener = null;
    w.location.href = url;
  } else window.location.assign(url);
  return true;
}
