// CR-157b: HĐ nhập tay (còn DRAFT) — tệp gốc hiện CẠNH form để đối chiếu (desktop 2 cột, dính khi cuộn). Dùng lại khung xem CR-149 (`Viewer`).
// Điện thoại: ẩn cột, dùng nút «Xem file gốc» ở `ManualBanner` (mở hộp thoại như cũ).
import { Viewer } from "./OriginalFileDialog";

type View = {
  id: string;
  status: string;
  entry_source?: "manual" | undefined;
  has_source?: boolean;
  file?: { name: string; mime: string } | null;
};

export function ManualSide({ c, show }: { c: View; show: boolean }) {
  if (!show || c.entry_source !== "manual" || c.status !== "draft" || !c.file) return null;
  return (
    <aside
      data-testid="manual-side"
      className="sticky top-4 hidden h-[calc(100dvh-2rem)] w-[44%] shrink-0 flex-col rounded-xl border border-rule bg-panel p-3 lg:flex"
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
