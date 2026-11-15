// fix-review-r1 · khung xem Word: <iframe sandbox srcdoc> — KHÔNG allow-scripts, KHÔNG allow-same-origin (origin rỗng, không chạm DOM/cookie của app).
// fix-review-r2 · thêm `allow-popups allow-popups-to-escape-sandbox` để liên kết https (target=_blank) trong tài liệu mở được TAB MỚI; tab mới không thừa hưởng sandbox.
export function DocxFrame({ srcDoc, title }: { srcDoc: string; title: string }) {
  return (
    <iframe
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      srcDoc={srcDoc}
      title={title}
      referrerPolicy="no-referrer"
      data-testid="docx-frame"
      className="min-h-0 w-full flex-1 rounded-md border border-rule bg-sunk"
    />
  );
}
