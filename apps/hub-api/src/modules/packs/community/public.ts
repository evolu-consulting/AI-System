// Cửa công khai của gói community cho module khác (ADR-0037): chỉ luật thuần (khe quy trình của gói).

export type { PartnerLinker, PartnerLinkFailKind } from "./application/pack-ports";
export { communitySlotSpecs } from "./domain/flow-slots.rules";
