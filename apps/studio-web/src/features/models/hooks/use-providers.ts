// HUB-FR-66 · danh sách provider (làm tươi 10 s) + chi tiết cho Sheet Sửa.
import { useQuery } from "@tanstack/react-query";
import { providerDetailQuery, providersQuery } from "../api";

export const useProviders = () => useQuery(providersQuery);
export const useProviderDetail = (id: string | null) =>
  useQuery({ ...providerDetailQuery(id ?? ""), enabled: id !== null });
