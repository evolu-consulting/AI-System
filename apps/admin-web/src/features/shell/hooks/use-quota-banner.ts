// ADM-FR-41 · M4-R06 · banner quota chỉ cho tenant_admin; platform/member không gọi API.
import { useSession } from "@/lib/auth/use-session";
import { useQuotaBannerQuery } from "../api";

export function useQuotaBanner() {
  const role = useSession((s) => s.me?.role);
  const { data } = useQuotaBannerQuery(role === "tenant_admin");
  return role === "tenant_admin" ? (data?.banner ?? null) : null;
}
