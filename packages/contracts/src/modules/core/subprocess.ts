// CR-125 · node «Quy trình con» (kind base, `baseExecutor` "subprocess"): MỘT ô trên sơ đồ đứng cho cả một quy trình khác của công ty
// (vd mua hàng 11 bước chia giai đoạn, mỗi giai đoạn một quy trình). Cổng cấu hình = zod của executor (bỏ `kind`/`branches` — Hub/canvas ghi);
// đầu ra = kết quả lượt con (`outcome`) — dữ liệu cuối của lượt con thêm động dưới khoá `sub_<trường>` (hub nodes/subprocess).
import type { z } from "zod";
import {
  SUBPROCESS_OUTCOME_FIELD,
  SubprocessExecutorSchema,
} from "../../hub-admin/process-subprocess";
import type { FeatureNodeDecl, PortSchema } from "../types";

/** Cổng cấu hình: quy trình con + nối đầu vào (đầu vào lượt con ← đường dữ liệu lượt cha). */
export const SubprocessConfigSchema = SubprocessExecutorSchema.pick({
  def_key: true,
  input_map: true,
});
export const SUBPROCESS_CONFIG_PORT: PortSchema = {
  schema: SubprocessConfigSchema,
  widgets: { def_key: "enum" },
};

export const SUBPROCESS_NODE: FeatureNodeDecl = {
  key: "core.subprocess",
  label: { vi: "Quy trình con", en: "Sub-process" },
  group: "content",
  menu: { section: "business", order: 55 },
  kind: "base",
  baseExecutor: "subprocess",
  configPort: SUBPROCESS_CONFIG_PORT,
  exits: [
    { key: "done", label: { vi: "Hoàn tất", en: "Completed" } },
    { key: "rejected", label: { vi: "Bị từ chối", en: "Rejected" }, on: ["rejected"] },
    { key: "cancelled", label: { vi: "Đã huỷ", en: "Cancelled" }, on: ["cancelled"] },
  ],
  stages: [{ executor: { kind: "subprocess", def_key: "" } }],
  inputs: [],
  outputs: [
    {
      key: SUBPROCESS_OUTCOME_FIELD,
      type: "string",
      required: true,
      label: { vi: "Kết quả quy trình con", en: "Sub-process outcome" },
    },
  ],
};

/** Kiểu cấu hình (panel đọc/ghi `executor.def_key` + `executor.input_map`). */
export type SubprocessConfig = z.infer<typeof SubprocessConfigSchema>;
