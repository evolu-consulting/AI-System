// C1 FE · F12 · thân câu trả lời: markdown nạp lazy; chunk chưa tới → chữ thô, không chặn stream (ADR-0006).
import { lazy, Suspense } from "react";
import { preloadHighlighter } from "../lib/highlight";

const loadMarkdown = () => import("./Markdown");
const Markdown = lazy(loadMarkdown);

/** Nạp sẵn chunk markdown + hljs khi trình duyệt rảnh (gọi sau đăng nhập). */
export function prefetchMarkdown(): void {
  const run = () => {
    void loadMarkdown().catch(() => {});
    void preloadHighlighter().catch(() => {});
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(run);
  else setTimeout(run, 2000);
}

export function AnswerBody({
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}) {
  return (
    <Suspense fallback={<div className="whitespace-pre-wrap break-words">{content}</div>}>
      <Markdown content={content} streaming={streaming} />
    </Suspense>
  );
}
