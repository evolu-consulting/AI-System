// HD-FR-26 · S04: nhập tay HĐ không file.
import type { ManualContractRequest, ManualContractResponse } from "@ai/contracts";
import { api } from "@ai/web-kit/http";

export function createManualContract(body: ManualContractRequest): Promise<ManualContractResponse> {
  return api<ManualContractResponse>("/pack/contracts/contracts/manual", { method: "POST", body });
}
