// CR-157b: HĐ nhập tay (còn DRAFT) — tệp gốc hiện CẠNH form để đối chiếu (desktop 2 cột ngang nhau full chiều rộng, dính khi cuộn). Dùng lại khung xem CR-149 (`Viewer`).
// Điện thoại: ẩn cột, dùng nút «Xem file gốc» ở `ManualBanner` (mở hộp thoại như cũ).
import { Viewer } from "./OriginalFileDialog";

type View = {
  id: string;
  status: string;
  entry_source?: "manual" | undefined;
  has_source?: boolean;
  file?: { name: string; mime: string } | null;
};

/** Hiện cột tệp gốc cạnh form? (nhập tay + còn nháp + có tệp + người xem có quyền ghi). */
export function showManualSide(c: View, show: boolean): boolean {
  return show && c.entry_source === "manual" && c.status === "draft" && !!c.file;
}

export function ManualSide({ c, show }: { c: View; show: boolean }) {
  if (!showManualSide(c, show) || !c.file) return null;
  return (
    <aside
      data-testid="manual-side"
      className="sticky top-4 hidden h-[calc(100dvh-2rem)] min-w-0 flex-col rounded-xl border border-rule bg-panel p-3 lg:flex"
    >
      <Viewer
        entry={{
          id: c.id,
          label: "",
          name: c.file.name,
          mime: c.file.mime,
          hasSource: c.has_source === true,
        }}
      />
    </aside>
  );
}
