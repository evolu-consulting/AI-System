// CR-193 BR-193-7 · Chính sách cuộn khi chuyển trang. Chuyển sang đường dẫn khác ⇒ router tự về đầu
// (và khôi phục vị trí khi Back/Forward, theo khoá lịch sử). Chỉ đổi query/hash của cùng trang ⇒ KHÔNG đụng tới cuộn.

/** Thuộc tính đánh dấu vùng cuộn chính (không phải window) để router reset/khôi phục. */
export const MAIN_SCROLL_ID = "main-scroll";
export const MAIN_SCROLL_SELECTOR = `[data-scroll-restoration-id="${MAIN_SCROLL_ID}"]`;
/** Trang bố cục `board` (danh sách/đối tác/sản phẩm): `main` đứng yên, khung nội dung bên trong mới cuộn từ md. */
export const BOARD_SCROLL_ID = "main-scroll-board";
export const BOARD_SCROLL_SELECTOR = `[data-scroll-restoration-id="${BOARD_SCROLL_ID}"]`;

/** Có cho router xử lý cuộn không: lần đầu hoặc đổi đường dẫn ⇒ có; cùng đường dẫn ⇒ không. */
export const shouldHandleScroll = (prevPath: string | undefined, nextPath: string): boolean =>
  prevPath === undefined || prevPath !== nextPath;

/** Tạo `scrollRestoration` cho router: nhớ đường dẫn trước để loại đổi-query cùng trang. */
export function createScrollRestoration(): (ctx: { location: { pathname: string } }) => boolean {
  let prev: string | undefined;
  return ({ location }) => {
    const go = shouldHandleScroll(prev, location.pathname);
    prev = location.pathname;
    return go;
  };
}

export const routerScrollOptions = () => ({
  scrollRestoration: createScrollRestoration(),
  scrollToTopSelectors: [MAIN_SCROLL_SELECTOR, BOARD_SCROLL_SELECTOR],
});
