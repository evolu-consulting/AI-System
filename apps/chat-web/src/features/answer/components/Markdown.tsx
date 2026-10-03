// C1 FE · F12 · render markdown GFM an toàn (ADR-0006): không HTML thô, URL nguy hiểm bị lọc, link mở tab mới.
// Chỉ nạp qua `AnswerBody` (React.lazy) → chunk riêng. Khối đã đóng được memo; chỉ khối cuối parse lại khi stream.
import {
  Children,
  type ComponentProps,
  isValidElement,
  memo,
  type ReactElement,
  useMemo,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { splitBlocks } from "../lib/blocks";
import { CodeBlock } from "./CodeBlock";

export type MarkdownProps = { content: string; streaming?: boolean };

const LINK = "text-primary-strong underline underline-offset-2";

function makeComponents(highlight: boolean): Components {
  return {
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
        {children}
      </a>
    ),
    // C1 không tải ảnh ngoài: ảnh hiện dạng link.
    img: ({ src, alt }) =>
      typeof src === "string" && src ? (
        <a href={src} target="_blank" rel="noopener noreferrer" className={LINK}>
          {alt || src}
        </a>
      ) : null,
    pre: ({ children }) => {
      const child = Children.toArray(children)[0];
      if (!isValidElement(child)) return <pre>{children}</pre>;
      const { className, children: text } = (child as ReactElement<ComponentProps<"code">>).props;
      const lang = /language-([\w+-]+)/.exec(className ?? "")?.[1];
      return (
        <CodeBlock code={String(text ?? "").replace(/\n$/, "")} lang={lang} highlight={highlight} />
      );
    },
    code: ({ children }) => (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{children}</code>
    ),
    table: ({ children }) => (
      <div className="my-3 overflow-x-auto">
        <table className="w-full border-collapse text-sm">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border border-border bg-muted px-2 py-1 text-left font-semibold">
        {children}
      </th>
    ),
    td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
    p: ({ children }) => <p className="my-2">{children}</p>,
    ul: ({ children }) => <ul className="my-2 list-disc pl-6">{children}</ul>,
    ol: ({ children }) => <ol className="my-2 list-decimal pl-6">{children}</ol>,
    blockquote: ({ children }) => (
      <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-strong-foreground">
        {children}
      </blockquote>
    ),
    h1: ({ children }) => <h3 className="mt-4 mb-2 text-lg font-semibold">{children}</h3>,
    h2: ({ children }) => <h3 className="mt-4 mb-2 text-base font-semibold">{children}</h3>,
    h3: ({ children }) => <h4 className="mt-3 mb-1 text-base font-semibold">{children}</h4>,
  };
}

const LIVE = makeComponents(false);
const DONE = makeComponents(true);
const PLUGINS = [remarkGfm];

const Block = memo(function Block({ text, highlight }: { text: string; highlight: boolean }) {
  return (
    <ReactMarkdown remarkPlugins={PLUGINS} components={highlight ? DONE : LIVE}>
      {text}
    </ReactMarkdown>
  );
});

export default function Markdown({ content, streaming = false }: MarkdownProps) {
  const blocks = useMemo(() => splitBlocks(content), [content]);
  const last = blocks.length - 1;
  return (
    <div className="break-words">
      {blocks.map((text, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: danh sách chỉ nối thêm ở cuối khi stream
        <Block key={i} text={text} highlight={!streaming || i < last} />
      ))}
      {streaming ? (
        <span
          aria-hidden
          className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-primary align-text-bottom motion-reduce:animate-none"
        />
      ) : null}
    </div>
  );
}
