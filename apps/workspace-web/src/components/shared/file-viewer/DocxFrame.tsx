// fix-review-r1 · khung xem Word: <iframe sandbox="" srcdoc> — KHÔNG allow-scripts, KHÔNG allow-same-origin (origin rỗng, không chạm DOM/cookie của app).
export function DocxFrame({ srcDoc, title }: { srcDoc: string; title: string }) {
  return (
    <iframe
      sandbox=""
      srcDoc={srcDoc}
      title={title}
      referrerPolicy="no-referrer"
      data-testid="docx-frame"
      className="min-h-0 w-full flex-1 rounded-md border border-rule bg-sunk"
    />
  );
}
