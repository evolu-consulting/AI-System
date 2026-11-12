// Dữ liệu test: def mẫu đóng băng (chép từ mẫu Thư viện cũ đã gỡ ở CR-127 Z4) — test lib/outline không phụ thuộc hub-api.
import { FLOW_A } from "./flow-a";
import { FLOW_B } from "./flow-b";
import { FLOW_C } from "./flow-c";
import { RECEIVE_RAW } from "./receive";

const clone = <T extends { stages: unknown }>(t: T) => ({
  ...t,
  stages: () => structuredClone(t.stages) as T["stages"],
});
export const FLOW_TEMPLATES = [...FLOW_A, ...FLOW_B, ...FLOW_C].map(clone);
export const RECEIVE_TEMPLATES = RECEIVE_RAW.map(clone);
