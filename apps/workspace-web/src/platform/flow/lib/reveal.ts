// CR-170 · bấm «Duyệt»/«Trả lại»/«Từ chối» ở đầu trang mà bước đòi bằng chứng ⇒ cuộn tới ô, đặt con trỏ vào ô ý kiến, làm nổi ô vài giây.
/** Số ms ô giữ nhấn sau khi hiện. */
export const REVEAL_FLASH_MS = 2500;

export type RevealTarget = {
  scrollIntoView?: (o: ScrollIntoViewOptions) => void;
};

/** Cuộn mượt tới `box` (tức thì nếu người dùng chọn giảm chuyển động) và đưa con trỏ vào `field`. */
export function revealEvidence(
  box: RevealTarget | null,
  field: { focus: (o?: FocusOptions) => void } | null,
  reducedMotion: boolean,
): void {
  box?.scrollIntoView?.({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
  field?.focus({ preventScroll: true });
}

export const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
