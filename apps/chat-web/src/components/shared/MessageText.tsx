// Tô token hành động ở ĐẦU tin: `@agent` hoặc `/command` (chỉ token đầu là có hiệu lực — HUB-FR-10/91, R16;
// `@x`/`/x` giữa tin giữ nguyên chữ thường). Dùng chung cho Hỏi AI (flow) và phòng.
import { leadingTag } from "~/features/agents/lib/mention";
import { leadingCommand } from "~/features/commands/lib/slash";

/** `@agent`/`/command` đầu tin → {prefix, token, rest}; không có → null. */
function leadingMention(text: string): { mark: string; rest: string } | null {
  const tag = leadingTag(text);
  if (tag !== null) return { mark: `@${tag}`, rest: text.slice(tag.length + 1) };
  const cmd = leadingCommand(text);
  if (cmd !== null) return { mark: `/${cmd}`, rest: text.slice(cmd.length + 1) };
  return null;
}

/** Nội dung tin người dùng: tô chip cho `@agent`/`/command` đầu tin; còn lại chữ thường. */
export function MessageText({ text }: { text: string }) {
  const m = leadingMention(text);
  if (m === null) return <>{text}</>;
  return (
    <>
      <span className="rounded bg-accent px-1 py-0.5 font-semibold text-accent-foreground">
        {m.mark}
      </span>
      {m.rest}
    </>
  );
}
