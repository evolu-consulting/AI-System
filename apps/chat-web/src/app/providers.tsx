// C1 FE · provider gốc: Query bọc Router (sự kiện phiên xoá cache: `query-client.ts`).
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { queryClient } from "./query-client";
import { router } from "./router";

export function Providers() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
