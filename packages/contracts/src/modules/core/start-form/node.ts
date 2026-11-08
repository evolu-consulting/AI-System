// CR-125 · cr125-manual-start-engine · khai báo node «Bắt đầu bằng phiếu yêu cầu» (khuôn CR-125). Bước cơ bản (`base`): stage đầu của
// flow, executor `set` rỗng (không AI, không người) — giá trị phiếu vào `process_runs.inputs` lúc bắt đầu (`POST /processes/start`),
// bước sau nối qua nguồn `start` như đầu ra «Bắt đầu khi». Cấu hình ở `stage.start_form` (= `configPort.schema`). Đầu ra động theo
// cấu hình (`startFormOutputs`), nên `outputs` tĩnh rỗng.
import type { FeatureNodeDecl } from "../../types";
import { START_FORM_NODE_KEY, StartFormConfigSchema } from "./config";

export const START_FORM_NODE: FeatureNodeDecl = {
  key: START_FORM_NODE_KEY,
  label: { vi: "Bắt đầu bằng phiếu yêu cầu", en: "Start with a request form" },
  group: "message",
  kind: "base",
  baseExecutor: "set",
  configPort: {
    schema: StartFormConfigSchema,
    widgets: { title_template: "text" },
  },
  // Bước có sẵn của trình sửa (như Duyệt/Nếu/Kết thúc): chỉ đặt được ở ĐẦU flow, không vào menu "+" ⇒ không có stage mẫu.
  stages: [],
  inputs: [],
  outputs: [],
};
