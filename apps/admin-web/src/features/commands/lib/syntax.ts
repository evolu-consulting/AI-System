// ADM-FR-20 · bước 3 · cú pháp hiển thị `/dich <lang = vi> <text…>` dựng từ tên và tham số (chỉ để người soạn xem).
import type { ArgValues } from "./schemas";

export function buildSyntax(
  name: string,
  args: readonly Pick<ArgValues, "name" | "default" | "rest">[],
): string {
  const parts = args
    .filter((a) => a.name !== "")
    .map((a) => {
      if (a.rest) return `<${a.name}…>`;
      const d = a.default.trim();
      return d === "" ? `<${a.name}>` : `<${a.name} = ${d}>`;
    });
  return [`/${name}`, ...parts].join(" ");
}

/** Cú pháp BA của một nguồn input map (chỉ đọc, kế bên ô chọn): `$args.lang`, `$selection`, `$page.url`… */
export function mapSyntax(e: { source: string; value: string }): string {
  switch (e.source) {
    case "arg":
      return e.value === "" ? "" : `$args.${e.value}`;
    case "selection":
      return "$selection";
    case "page_url":
      return "$page.url";
    case "page_text":
      return "$page.text";
    case "attachment":
      return "$attachment";
    case "user_id":
      return "$user.id";
    case "tenant_id":
      return "$tenant.id";
    case "const":
      return JSON.stringify(e.value);
    default:
      return "";
  }
}
