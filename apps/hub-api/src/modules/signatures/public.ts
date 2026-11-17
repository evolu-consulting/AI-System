// ADR-0037 · cửa công khai DUY NHẤT của module `signatures` (CR-181): module khác chỉ import file này (theo tên, không `export *`).
export { type SignaturesRepo, signaturesRepo } from "./adapters/signatures.repo";
export type {
  ChangeGrantResult,
  ChangeGrantState,
  SignatureCreated,
  SignatureHistoryRow,
  SignatureRecord,
  SignatureSettingsRecord,
} from "./domain/signature.types";
