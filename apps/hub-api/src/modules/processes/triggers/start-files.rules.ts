// CR-125 · cr125-run-attachments · luật THUẦN: id tệp trong giá trị phiếu «Tạo yêu cầu» (chỉ ô loại `attachments`).
import type { StartFormConfig } from "@ai/contracts/modules";
import { uuidsIn } from "../../attachments/public";

export function startFormFileIds(
  cfg: Pick<StartFormConfig, "fields">,
  values: Readonly<Record<string, unknown>>,
): string[] {
  return uuidsIn(
    cfg.fields
      .filter((f) => f.type === "attachments")
      .flatMap((f) => {
        const v = values[f.key];
        return Array.isArray(v) ? v : [];
      }),
  );
}
