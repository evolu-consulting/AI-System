// ADM-FR-65 · CR-056 · P-a Bước 0: STUB PF4 (F5) — trang lượt chạy của admin (`/processes/$processId/runs/$runId`: Tiến độ / Token / Nhật ký).
import { ProcessRouteGate } from "../components/ProcessRouteGate";

export type ProcessRunPageProps = { processId: string; runId: string };

export function ProcessRunPage(_props: ProcessRunPageProps) {
  return <ProcessRouteGate>{null}</ProcessRouteGate>;
}
