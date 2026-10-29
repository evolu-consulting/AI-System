// CR-103 · R1 · node `apply` (P-c2, PC2-R01): "Áp bản sửa" — Hub tự chạy sau stage tự-sửa. Luật def (`APPLY_*`) nằm ở
// contract; ở đây chỉ cờ năng lực.
import { NODE_FAMILY_OF } from "@ai/contracts/hub-admin";
import type { NodeSpec } from "../types";

export const applyNode: NodeSpec<"apply"> = {
  kind: "apply",
  family: NODE_FAMILY_OF.apply,
  produces: "none",
  // C32 · stage Áp `real_action` ⇒ cổng hành động thật (actor = người Đạt bước trước, không agent).
  realAction: true,
  handoff: false,
};
