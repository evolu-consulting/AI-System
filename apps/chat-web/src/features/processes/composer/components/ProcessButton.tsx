// CR-056 · P-a Bước 0: STUB PF1 — nút "Quy trình" cạnh nút Gửi: chèn `!` vào ô và mở menu.
export type ProcessButtonProps = {
  /** Điền `text` vào ô nhập (Composer `change`). */
  onInsert(text: string): void;
  disabled?: boolean;
};

export function ProcessButton(_props: ProcessButtonProps) {
  return null;
}
