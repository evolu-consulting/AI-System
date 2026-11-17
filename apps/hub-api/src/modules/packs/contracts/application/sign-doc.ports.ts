// CR-181 · s8 · cổng (kiểu) của use case «Ký trên tài liệu» — adapter `sign-doc.repo` và các repo s6 thoả cấu trúc (khuôn `contract-files.usecase`).
import type { SignerKindApi, SignParts, SignSide } from "@ai/contracts/pack-contracts";
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
export type SignVersionRowP = { id: string; file_id: string; seq: number };
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
  };
  versions: { latestByContract(contractId: string): PromiseLike<SignVersionRowP[]> };
};
