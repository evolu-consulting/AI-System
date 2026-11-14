// CR-149 · Word .docx bằng docx-preview (nạp lười). Chỉ chạy trên bytes đã tải qua route có kiểm quyền; không chạy script trong tệp.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export default function DocxPane({ blob, onError }: { blob: Blob; onError: () => void }) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let dead = false;
    (async () => {
      const { renderAsync } = await import("docx-preview");
      if (dead) return;
      await renderAsync(blob, el, undefined, {
        inWrapper: true,
        ignoreWidth: false,
        breakPages: true,
        useBase64URL: true,
        renderHeaders: true,
        renderFooters: true,
      });
      if (!dead) setReady(true);
    })().catch(() => !dead && onError());
    return () => {
      dead = true;
      el.replaceChildren();
    };
  }, [blob, onError]);
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="docx-viewer">
      {!ready && <p className="p-2 text-label text-dim">{t("contracts.fview.loading")}</p>}
      <div
        ref={host}
        className="min-h-0 flex-1 overflow-auto rounded-md border border-rule bg-sunk"
      />
    </div>
  );
}
