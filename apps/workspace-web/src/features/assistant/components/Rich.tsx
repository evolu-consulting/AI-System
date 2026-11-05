// M2-chat · Markdown tối giản của câu trả lời (port `Rich` của mgmt-app `assistant/Panel.tsx`): **đậm**, liên kết https, "- "
// danh sách, "### " tiêu đề, | bảng |. Không HTML thô (React tự thoát), liên kết chỉ http(s), mở tab mới không kèm ngữ cảnh.
import { Fragment, type ReactNode } from "react";

const INLINE = /(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s)<]+)/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEP = /^\s*\|[\s:|-]+\|\s*$/;
const LIST = /^(\s*)([-*•]|\d+\.)\s+(.*)$/;

const link = (href: string, text: string, key: string) => (
  <a
    key={key}
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="break-all text-act underline underline-offset-2"
  >
    {text}
  </a>
);

function inline(s: string, k: number | string): ReactNode[] {
  return s.split(INLINE).map((part, j) => {
    const key = `${k}-${j}`;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
      return <b key={key}>{part.slice(2, -2)}</b>;
    const md = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(part);
    if (md) return link(md[2] as string, md[1] as string, key);
    if (/^https?:\/\//.test(part)) return link(part, part, key);
    return <Fragment key={key}>{part}</Fragment>;
  });
}

const cells = (l: string) =>
  l
    .trim()
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim());

function Table({ rows, k }: { rows: string[][]; k: number }) {
  const [head, ...body] = rows;
  return (
    <div className="my-1.5 overflow-x-auto">
      <table className="min-w-full text-[12.5px] [&_td]:min-w-[7.5rem] [&_th]:min-w-[7.5rem]">
        <thead>
          <tr>
            {head?.map((c, j) => (
              <th
                // biome-ignore lint/suspicious/noArrayIndexKey: ô bảng tĩnh theo vị trí
                key={`${k}-h${j}`}
                className="border-rule border-b px-1.5 py-1 text-left font-semibold"
              >
                {inline(c, `${k}h${j}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: hàng bảng tĩnh theo vị trí
            <tr key={`${k}-r${i}`}>
              {r.map((c, j) => (
                <td
                  // biome-ignore lint/suspicious/noArrayIndexKey: ô bảng tĩnh theo vị trí
                  key={`${k}-${i}-${j}`}
                  className="border-rule-soft border-b px-1.5 py-1 align-top"
                >
                  {inline(c, `${k}${i}${j}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function line(l: string, i: number): ReactNode {
  const m = LIST.exec(l);
  if (m) {
    const mark = /\d/.test(m[2] as string) ? m[2] : "•";
    return (
      <p key={i} className={`flex gap-1.5 ${(m[1] as string).length ? "pl-4" : ""}`}>
        <span className="text-dim">{mark}</span>
        <span>{inline(m[3] as string, i)}</span>
      </p>
    );
  }
  if (/^#{1,4}\s/.test(l))
    return (
      <p key={i} className="mt-1 font-semibold">
        {inline(l.replace(/^#+\s/, ""), i)}
      </p>
    );
  if (l.trim()) return <p key={i}>{inline(l, i)}</p>;
  return <div key={i} className="h-1.5" />;
}

export function Rich({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (TABLE_ROW.test(lines[i] as string)) {
      const rows: string[][] = [];
      const start = i;
      for (; i < lines.length && TABLE_ROW.test(lines[i] as string); i++)
        if (!TABLE_SEP.test(lines[i] as string)) rows.push(cells(lines[i] as string));
      i--;
      out.push(<Table key={start} rows={rows} k={start} />);
    } else out.push(line(lines[i] as string, i));
  }
  return <div className="space-y-0.5">{out}</div>;
}
