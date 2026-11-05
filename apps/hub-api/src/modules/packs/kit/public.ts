// Cửa công khai của kit gói cho module khác (ADR-0037): chỉ registry nhãn bản ghi + kiểu.
export { recordLabelRegistry } from "./adapters/record-label-registry";
export type {
  RecordLabelRegistry,
  RecordLabelSource,
} from "./application/record-label.ports";
