// Tô token hành động ở ĐẦU tin: `@agent` (indigo), `/command` (amber), `!process` (teal) — chỉ token đầu có hiệu lực
// (HUB-FR-10/91, R16; giữa tin giữ nguyên chữ; `@@`/`//`/`!!` là escape). Dùng chung cho Hỏi AI (flow) và phòng.
import { leadingTag } from "~/features/agents/lib/mention";
import { leadingCommand } from "~/features/commands/lib/slash";

const LEADING_PROCESS = /^!([^\s!]\S*)/;

/** `!process` đầu tin → tên (không gồm `!`); `!!x` (escape) hoặc không có → null. */
export function leadingProcess(text: string): string | null {
  return LEADING_PROCESS.exec(text)?.[1] ?? null;
}

const CHIP = "rounded px-1 py-0.5 font-semibold";
/** Nền trung tính (tin người khác, flow): chip tint cùng hệ màu loại. */
const TINT = {
  agent: `${CHIP} bg-mention-agent/15 text-mention-agent`,
  command: `${CHIP} bg-mention-command/15 text-mention-command`,
  process: `${CHIP} bg-mention-process/15 text-mention-process`,
} as const;
/** Trên bong bóng tin của mình (nền `primary` đặc): pill trắng + chữ màu loại ⇒ đọc được trên nền indigo. */
const SOLID = {
  agent: `${CHIP} bg-primary-foreground text-mention-agent`,
  command: `${CHIP} bg-primary-foreground text-mention-command`,
  process: `${CHIP} bg-primary-foreground text-mention-process`,
} as const;

type Mention = { kind: keyof typeof TINT; mark: string; rest: string };

function leadingMention(text: string): Mention | null {
  const tag = leadingTag(text);
  if (tag !== null) return { kind: "agent", mark: `@${tag}`, rest: text.slice(tag.length + 1) };
  const cmd = leadingCommand(text);
  if (cmd !== null) return { kind: "command", mark: `/${cmd}`, rest: text.slice(cmd.length + 1) };
  const proc = leadingProcess(text);
  if (proc !== null)
    return { kind: "process", mark: `!${proc}`, rest: text.slice(proc.length + 1) };
  return null;
}

/** Nội dung tin người dùng: tô chip theo loại mention đầu tin; còn lại chữ thường.
 * `onPrimary` = tin trên nền `bg-primary` (bong bóng của mình) ⇒ pill trắng cho đọc được. */
export function MessageText({ text, onPrimary = false }: { text: string; onPrimary?: boolean }) {
  const m = leadingMention(text);
  if (m === null) return <>{text}</>;
  return (
    <>
      <span className={(onPrimary ? SOLID : TINT)[m.kind]}>{m.mark}</span>
      {m.rest}
    </>
  );
}
