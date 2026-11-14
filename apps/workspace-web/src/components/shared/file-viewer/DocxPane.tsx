// CR-149 · Word .docx bằng docx-preview (nạp lười). Chỉ chạy trên bytes đã tải qua route có kiểm quyền.
// fix-review-r1 (XSS): docx-preview dựng HTML trong phần tử TẠM ngoài DOM của app ⇒ `sanitizeDocxDom` ⇒ đưa vào `<iframe sandbox="" srcdoc>`
// (không script, không same-origin). Liên kết chỉ http(s)/mailto/#.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DocxFrame } from "./DocxFrame";
import { buildSrcdoc, sanitizeDocxDom } from "./docx-safe";

export default function DocxPane({ blob, onError }: { blob: Blob; onError: () => void }) {
  const { t } = useTranslation();
  const [doc, setDoc] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    (async () => {
      const { renderAsync } = await import("docx-preview");
      if (dead) return;
      const body = document.createElement("div");
      const styles = document.createElement("div");
      await renderAsync(blob, body, styles, {
        inWrapper: true,
        ignoreWidth: false,
        breakPages: true,
        useBase64URL: true,
        renderHeaders: true,
        renderFooters: true,
      });
      if (dead) return;
      sanitizeDocxDom(body);
      setDoc(buildSrcdoc(body.innerHTML, styles.innerHTML));
    })().catch(() => !dead && onError());
    return () => {
      dead = true;
    };
  }, [blob, onError]);
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="docx-viewer">
      {doc === null && <p className="p-2 text-label text-dim">{t("contracts.fview.loading")}</p>}
      {doc !== null && <DocxFrame srcDoc={doc} title={t("contracts.fview.docxTitle")} />}
    </div>
  );
}
