// CR-146b · danh sách người dùng của công ty cho ô «Người phụ trách hợp đồng nhận» ở TriggerCard. Component không gọi `api.ts` trực tiếp ⇒ qua hook này.
import { useAgentUserOptions } from "@/features/agents/api";

export function useUserOptions(tenantId: string | undefined, enabled: boolean) {
  const q = useAgentUserOptions(tenantId, enabled);
  return { users: q.data ?? [] };
}
