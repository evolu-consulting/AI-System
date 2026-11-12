// CR-130 · bấm thông báo Bảng tin ⇒ `/community?post=<id>`: cuộn tới đúng bài và đánh dấu (khi danh sách đã tải).
import { useEffect } from "react";
import { focusPostId } from "../domain/search-hint";

export function useFocusPost(loaded: boolean): void {
  useEffect(() => {
    if (!loaded) return;
    const id = focusPostId(location.search);
    if (!id) return;
    const el = document.querySelector<HTMLElement>(`[data-post-id="${id}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.classList.add("focused");
  }, [loaded]);
}
