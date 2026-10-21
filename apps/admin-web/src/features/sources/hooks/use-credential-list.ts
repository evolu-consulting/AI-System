// HUB-FR-68 · PC2-R10 · FC2 · danh sách khoá nguồn của tenant (lazy) cho sheet + ô chọn khoá trong form nguồn.
import type { HubSecret } from "@ai/contracts/hub-admin";
import { useCredentials } from "../api";

export type CredentialList = {
  items: HubSecret[];
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
};

export function useCredentialList(tenantId: string | undefined): CredentialList {
  const list = useCredentials(tenantId, true);
  return {
    items: list.data?.items ?? [],
    isPending: list.isPending,
    isError: list.isError,
    refetch: () => void list.refetch(),
  };
}
