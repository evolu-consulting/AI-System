// HUB-FR-44 · X2b-2 D6/D7 · dòng ghi chú dưới hàng nhập khi có tệp trong tin của phòng: ai xem được tệp, hoặc "cần chữ".
export type AttachNoteText = { share: string; needText: string };

/** Hiện khi có ≥ 1 chip: luôn có `share`; thêm `needText` khi chưa có chữ (Gửi đang disabled). */
export function attachNoteOf(
  note: AttachNoteText | undefined,
  chipCount: number,
  text: string,
): string[] | null {
  if (!note || chipCount === 0) return null;
  return text.trim() === "" ? [note.needText, note.share] : [note.share];
}

/** Nối id mô tả cho `aria-describedby` của textarea (bỏ phần vắng). */
export const joinDescribedBy = (
  ...ids: (string | false | null | undefined)[]
): string | undefined => ids.filter(Boolean).join(" ") || undefined;

export function AttachNote({ id, text }: { id: string; text: string[] | null }) {
  if (text === null) return null;
  return (
    <div id={id} className="mt-1 space-y-0.5 px-1 text-xs text-muted-foreground">
      {text.map((t) => (
        <p key={t} role="note">
          {t}
        </p>
      ))}
    </div>
  );
}
