// CR-181 · s8 · cổng (kiểu) của use case «Ký trên tài liệu» — adapter `sign-doc.repo` và các repo s6 thoả cấu trúc (khuôn `contract-files.usecase`).
import type {
  SignatureKind,
  SignerKindApi,
  SignParts,
  SignPlacement,
  SignSide,
} from "@ai/contracts/pack-contracts";
import type { ContractFilesRepo } from "./contract-files.usecase";

export type SignFileRef = {
  file_id: string;
  name: string;
  mime: string;
  org: string;
  box_id: string;
  is_main: boolean;
  added_by: string | null;
};
export type PartnerSigner = {
  name: string | null;
  email: string | null;
  partner_name: string | null;
};
export type SignDocRowP = { file_id: string; needs_sign: boolean; pages: number | null };
export type SignFieldRowP = {
  id: string;
  file_id: string;
  side: SignSide;
  signer_kind: SignerKindApi;
  signer_ref: string;
  label: string;
  parts: SignParts;
  signed_by: string | null;
  signed_version_id: string | null;
};
export type SignVersionRowP = {
  id: string;
  file_id: string;
  seq: number;
  out_file_id: string;
  sha256: string;
  signed_by: string;
  signature_kind: SignatureKind;
  run_id: string | null;
  created_at: Date | string;
  voided_at: Date | string | null;
};
export type SignMarkRowP = {
  signer_id: string;
  field_id: string | null;
  placement: SignPlacement;
  parts: SignParts;
  caption: string | null;
};
export type NewSignVersionP = {
  id: string;
  contractId: string;
  fileId: string;
  outFileId: string;
  sha256: string;
  signedBy: string;
  kind: SignatureKind;
  runId: string | null;
  marks: readonly {
    fieldId: string | null;
    placement: SignPlacement;
    parts: SignParts;
    userSignatureId: string;
    caption: string | null;
  }[];
};
export type OutFileRef = { org: string; box_id: string; name: string };
export type NewSignFieldP = {
  id: string;
  side: SignSide;
  signerKind: SignerKindApi;
  signerRef: string;
  label: string;
  parts: SignParts;
};

export type SignDocRepos = {
  contractFiles: ContractFilesRepo;
  signDoc: {
    files(contractId: string): PromiseLike<SignFileRef[]>;
    partner(contractId: string): Promise<PartnerSigner | null>;
    /** Khoá hàng `sign_docs` (FOR UPDATE) trước khi kiểm bản mới nhất + thêm bản. */
    lockDoc(contractId: string, fileId: string): Promise<boolean>;
    insertOutFile(r: {
      id: string;
      org: string;
      boxId: string;
      versionId: string;
      name: string;
      size: number;
      by: string;
    }): Promise<void>;
    /** Tệp ra của một bản (kể cả bản đã huỷ — BR-X1). */
    outFile(contractId: string, fileId: string, versionId: string): Promise<OutFileRef | null>;
    outFileById(fileRowId: string): Promise<OutFileRef | null>;
  };
  docs: {
    listByContract(contractId: string): PromiseLike<SignDocRowP[]>;
    get(contractId: string, fileId: string): Promise<SignDocRowP | null>;
    set(
      contractId: string,
      fileId: string,
      needsSign: boolean,
      pages: number | null,
      by: string,
    ): Promise<SignDocRowP | null>;
  };
  fields: {
    listByContract(contractId: string): PromiseLike<SignFieldRowP[]>;
    listByFile(contractId: string, fileId: string): PromiseLike<SignFieldRowP[]>;
    replaceForFile(
      contractId: string,
      fileId: string,
      fields: readonly NewSignFieldP[],
      by: string,
    ): Promise<unknown>;
    markSigned(
      contractId: string,
      fieldIds: readonly string[],
      by: string,
      versionId: string,
    ): Promise<number>;
  };
  versions: {
    latestByContract(contractId: string): PromiseLike<SignVersionRowP[]>;
    latest(contractId: string, fileId: string): Promise<SignVersionRowP | null>;
    list(
      contractId: string,
      fileId: string,
    ): PromiseLike<(SignVersionRowP & { marks: SignMarkRowP[] })[]>;
    add(v: NewSignVersionP): Promise<{ id: string; seq: number } | null>;
  };
};
