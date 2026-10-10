// ADM-FR-66 · CR-056 · P-a Bước 0: STUB PF4 (F5) — editor quy trình (`/processes/new`, `/processes/$processId`). `processId` vắng ⇒ tạo mới.
import { ProcessRouteGate } from "../components/ProcessRouteGate";

export type ProcessEditorPageProps = { processId?: string };

export function ProcessEditorPage(_props: ProcessEditorPageProps) {
  return <ProcessRouteGate>{null}</ProcessRouteGate>;
}
