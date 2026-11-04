// V2-F · BA 5.7: sắc thái nhãn kho — Nhập kho (xanh), Xuất kho (tím), Không ảnh hưởng kho (xám). Thuần.
import type { TagTone } from "~/components/shared/tag";

export const stockTone = (e: "in" | "out" | "none"): TagTone =>
  e === "in" ? "ok" : e === "out" ? "act" : "grey";
