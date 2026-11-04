// CR-105 L4 · truy vấn quy trình duyệt đang dùng (chỉ đọc).
import { useQuery } from "@tanstack/react-query";
import { fetchFlow, flowKeys } from "../api-flow";

export const useFlow = (enabled: boolean) =>
  useQuery({
    queryKey: flowKeys.flow,
    queryFn: ({ signal }) => fetchFlow(signal),
    enabled,
    retry: false,
  });
