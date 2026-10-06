// HUB-FR-10 · luật thuần menu `/` (plan-frontend §1.1): khi nào mở, lọc theo tên/alias, điền lệnh.
import type { CommandMenuArg, CommandMenuItem } from "@ai/contracts/chat";

/** Số dòng thấy cùng lúc (còn lại cuộn). */
export const MENU_VISIBLE_ROWS = 8;

/**
 * Phần gõ sau `/` khi menu phải mở: ký tự đầu là `/`, không phải `//`, chưa có khoảng trắng trước con trỏ.
 * Trả `null` khi không mở.
 */
export function slashQuery(text: string, caret: number): string | null {
  if (!text.startsWith("/") || text.startsWith("//")) return null;
  const head = text.slice(0, Math.max(caret, 1));
  if (/\s/.test(head)) return null;
  return head.slice(1);
}

export type CommandMatch = { item: CommandMenuItem; alias: string | null };

/** Tiền tố `name` hoặc alias, không phân biệt hoa thường; khớp qua alias → `alias`. Sắp theo `name` (Hub đã sắp; sắp lại để chắc thứ tự menu). */
export function filterCommands(items: readonly CommandMenuItem[], q: string): CommandMatch[] {
  const needle = q.toLowerCase();
  const out: CommandMatch[] = [];
  for (const item of items) {
    if (item.name.toLowerCase().startsWith(needle)) {
      out.push({ item, alias: null });
      continue;
    }
    const alias = item.aliases.find((a) => a.toLowerCase().startsWith(needle));
    if (alias !== undefined) out.push({ item, alias });
  }
  return out.sort((a, b) => (a.item.name < b.item.name ? -1 : a.item.name > b.item.name ? 1 : 0));
}

/** `<arg>` bắt buộc, `[arg]` tuỳ chọn, `rest` thêm `…`. */
export function argSyntax(arg: CommandMenuArg): string {
  const name = arg.rest ? `${arg.name}…` : arg.name;
  return arg.required ? `<${name}>` : `[${name}]`;
}

/** `en` null → `vi`. */
export function describe(desc: { vi: string; en: string | null }, lang: string): string {
  return lang.toLowerCase().startsWith("en") ? (desc.en ?? desc.vi) : desc.vi;
}

/** Tên lệnh ở đầu tin (`/tranlate en hi` → `tranlate`); `//x` và tin thường → `null`. */
export function leadingCommand(text: string): string | null {
  const m = /^\/([^\s/]\S*)/.exec(text);
  return m?.[1] ?? null;
}

/** Điền `/name ` thay token đầu, giữ phần sau; con trỏ ngay sau khoảng trắng. */
export function fillCommand(text: string, name: string): { text: string; caret: number } {
  const end = text.search(/\s/);
  const rest = end === -1 ? "" : text.slice(end).trimStart();
  const head = `/${name} `;
  return { text: head + rest, caret: head.length };
}

/** Đổi tên lệnh ở đầu tin (gợi ý "Ý bạn là"): giữ phần sau. */
export function replaceCommandName(text: string, name: string): string {
  return text.replace(/^\/\S*/, `/${name}`);
}
