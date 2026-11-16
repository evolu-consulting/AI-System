// CR-179 · kiểu props của AttachGallery tách riêng để AttachViewer dùng mà không tạo vòng import.
import type { AttachItem, AttachLabels } from "../attach-layout";

export type AttachGalleryProps = {
  items: readonly AttachItem[];
  getUrl: (id: string) => Promise<string>;
  onDownload: (item: AttachItem) => void;
  labels: AttachLabels;
  locale?: string;
  /** Nhãn danh sách thẻ tệp (a11y). */
  ariaLabel?: string;
  /** CR-166: `center` ⇒ căn giữa khung chứa (Community); mặc định `start` (chat). */
  align?: "start" | "center";
};
