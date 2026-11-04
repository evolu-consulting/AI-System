// CR-118 · điều hướng TRONG app (không tải lại trang) tới URL /community/*: giữ trạng thái bộ nhớ (vd persona mock) như đổi hash trước đây.
import type { Page } from "@playwright/test";

export const spa = (page: Page, url: string): Promise<void> =>
  page.evaluate((u) => {
    history.pushState(null, "", u);
    dispatchEvent(new PopStateEvent("popstate"));
  }, url);
