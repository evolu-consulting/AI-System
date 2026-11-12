// HD-FR-01 · HD-FR-03 · D-04 · CR-127 K1a (BR-01): kiểu trạng thái hợp đồng — 4 trạng thái, nguồn duy nhất `contract-state.rules.ts`
// (khớp `CONTRACT_STATUSES` ở contract zod; domain không import ngoài built-in nên khai lại).
import { CONTRACT_STATES, type ContractState, isContractState } from "./contract-state.rules";

export const CONTRACT_STATUS_ORDER = CONTRACT_STATES;
export type ContractStatus = ContractState;

export const isContractStatus = isContractState;
