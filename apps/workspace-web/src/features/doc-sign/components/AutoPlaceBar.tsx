// CR-181 · s12 · thanh «Tự đặt theo ĐẠI DIỆN BÊN A/B» (chế độ chuẩn bị): đọc chữ của tệp, báo đã đặt n ô hoặc không thấy.
import { Button } from "@ai/web-kit/ui/kit/button";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PageSize } from "../lib/layout";
import type { SignItem } from "../lib/sign-items";

export function AutoPlaceBar(p: {
  fileId: string;
  pdf: { doc: PDFDocumentProxy; sizes: PageSize[] } | null;
  autoPlace: (doc: PDFDocumentProxy, sizes: PageSize[]) => Promise<SignItem[]>;
  onFound: (items: SignItem[]) => void;
}) {
  const { t } = useTranslation();
  const [n, setN] = useState<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: đổi tệp ⇒ xoá thông báo cũ
  useEffect(() => setN(null), [p.fileId]);
  const run = async () => {
    if (!p.pdf) return;
    const found = await p.autoPlace(p.pdf.doc, p.pdf.sizes);
    if (found.length) p.onFound(found);
    setN(found.length);
  };
  return (
    <div className="flex items-center gap-3 border-b px-3 py-1">
      <Button size="sm" variant="outline" disabled={!p.pdf} onClick={run}>
        {t("contracts.docsign.autoPlace")}
      </Button>
      {n !== null && (
        <p role="status" className="text-sm text-muted-foreground">
          {n > 0 ? t("contracts.docsign.autoDone", { count: n }) : t("contracts.docsign.autoNone")}
        </p>
      )}
    </div>
  );
}
