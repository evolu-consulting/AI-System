// Cửa công khai của kit gói cho module khác (ADR-0037): registry nhãn bản ghi + registry mục hàng việc của menu + kiểu.

export type { PackAccessView } from "./adapters/pack-guard.middleware";
export { packNavRegistry } from "./adapters/pack-nav-registry";
export { recordLabelRegistry } from "./adapters/record-label-registry";
export type { ExternalOrgResolver } from "./application/ext-org.ports";
export type {
  PackNavCap,
  PackNavRegistry,
  PackNavSource,
} from "./application/pack-nav.ports";
export type {
  RecordLabelRegistry,
  RecordLabelSource,
} from "./application/record-label.ports";
