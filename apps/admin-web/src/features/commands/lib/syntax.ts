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
