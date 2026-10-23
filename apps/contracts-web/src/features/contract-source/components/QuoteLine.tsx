// gap-a2 #3: dòng trích dẫn AI + nút "Xem đoạn này trong văn bản gốc". Trang HĐ cấp `SourceViewerContext` (có văn bản gốc);
// nơi khác (form nhập tay…) không có context ⇒ chỉ hiện trích dẫn.
import { createContext, useContext } from "react";

export type SourceViewer = { show: (quote: string) => void };
export const SourceViewerContext = createContext<SourceViewer | null>(null);

export function QuoteLine({ quote, className }: { quote: string; className?: string }) {
  const viewer = useContext(SourceViewerContext);
  return (
    <span className={className ?? "text-[12px] text-dim italic"}>
      “{quote}”
      {/* Người dùng 2026-10-23: bỏ khoang "Văn bản gốc" ⇒ không còn link "Xem đoạn này" (code `SourceViewerContext` giữ lại). */}
      {viewer && null}
    </span>
  );
}
