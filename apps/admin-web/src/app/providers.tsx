// ADM-NFR-06, ADM-FR-01 · provider gốc: Query bọc Router; sự kiện phiên điều khiển cache (đăng xuất → xoá, đăng nhập lại → tải lại).
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { session } from "@/lib/auth/session";
import { queryClient } from "./query-client";
import { router } from "./router";

session.on("cleared", () => queryClient.clear());
session.on("reauthed", () => void queryClient.invalidateQueries());

export function Providers() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
