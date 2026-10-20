// V2-H · SP-03: khách đang dùng của một SP (một lần tải; lọc ở máy khách).
import { useQuery } from "@tanstack/react-query";
import { customersKey, fetchServiceCustomers } from "../api";

export const useServiceCustomers = (productId: string) =>
  useQuery({
    queryKey: customersKey(productId),
    queryFn: ({ signal }) => fetchServiceCustomers(productId, signal),
  });
