// gap-a2 #3: dòng trích dẫn AI + nút "Xem đoạn này trong văn bản gốc". Trang HĐ cấp `SourceViewerContext` (có văn bản gốc);
// nơi khác (form nhập tay…) không có context ⇒ chỉ hiện trích dẫn.
import { createContext, useContext } from "react";
import { useTranslation } from "react-i18next";

export type SourceViewer = { show: (quote: string) => void };
export const SourceViewerContext = createContext<SourceViewer | null>(null);

export function QuoteLine({ quote, className }: { quote: string; className?: string }) {
  const { t } = useTranslation();
  const viewer = useContext(SourceViewerContext);
  return (
    <span className={className ?? "text-[12px] text-dim italic"}>
      “{quote}”
      {viewer && (
        <button
          type="button"
          className="ml-2 not-italic text-act underline-offset-2 hover:underline"
          onClick={() => viewer.show(quote)}
        >
          {t("contracts.assistant.srcSeeQuote")}
        </button>
      )}
    </span>
  );
}
