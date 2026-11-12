// CR-127 R1 #3 · tách từ extraction.mount.ts: kiểu seam AI/flow của gói contracts.
import type { Hono } from "hono";
import type { Redis } from "ioredis";
import type { AiClient } from "../../../lib/ai-client/ai-client";
import type { PackGuardVars, PackWho } from "../kit/public";
import type { ActionQuota } from "./adapters/action-quota";
import type { AgentTransport } from "./adapters/extraction-agent";
import type { FileContent } from "./adapters/source-file-text";
import type { ApprovalGroups } from "./application/approval.usecase";
import type { ApprovalEngineBridge } from "./application/approval-engine.ports";
import type { EvidenceBytes, EvidenceNames } from "./application/approval-engine-card.usecase";
import type { FlowGroups } from "./application/approval-flow.usecase";
import type { SweepDeps, sweepApprovalsOnce } from "./application/approval-sweep";
import type { SourceFileText, TaxRegistry } from "./application/extraction.ports";
import type { myApprovals } from "./application/mywork-approvals.usecase";
import type { ExtractionOutcome } from "./application/run-extraction.usecase";
import type { ExtractionStarter } from "./application/upload-contract.ports";
import type { EsignHooks } from "./approval.mount";

/** Seam `PacksDeps.contractsAi` (test ↔ hub-api). */
export type ContractsAiDeps = {
  /** HD2 · transport giả ⇒ đường HD2 (không mở lượt duyệt). Vắng ⇒ chế độ flow (AI client chung). */
  transport?: AgentTransport;
  /** Vắng ⇒ `packs.mount.ts` dựng theo env `CONTRACTS_TAX_LOOKUP_URL`; null ⇒ không tra. */
  tax?: TaxRegistry | null;
  concurrency?: number;
  onSettled?: (contractId: string, outcome: ExtractionOutcome | "error") => void;
  /** M3 · test gọi lượt quét / nhận lại job trực tiếp (vòng quét nền tắt khi có hook). */
  onHandles?: (h: {
    sweepOnce: () => ReturnType<typeof sweepApprovalsOnce>;
    reclaimOnce: () => Promise<number>;
  }) => void;
  /** cr121-a2 · CHỈ TEST: `false` ⇒ lượt mới mở ở máy 2 bước cũ (hồi quy đường decide cũ cho lượt máy cũ còn dở — HD3/K1/K4);
   *  vắng/`true` ⇒ engine (như chạy thật). Không có env nào bật được nhánh này; gỡ cùng máy cũ. */
  approvalEngine?: boolean;
  /** CR-127 · E4b · đọc byte tệp/chữ ký của bằng chứng duyệt — cổng hub tiêm ở `packs.mount.ts`; vắng ⇒ tải tệp bằng chứng 404. */
  evidenceBytes?: EvidenceBytes | undefined;
  /** CR-127 · U4b-3 · tên tệp bằng chứng cho PDF Hồ sơ duyệt (cổng hub tiêm). */
  evidenceNames?: EvidenceNames | undefined;
};

export type ContractsAi = {
  starter: ExtractionStarter;
  routes: Hono<PackGuardVars>;
  approval: Hono<PackGuardVars>;
  /** contract-flow S3b · việc duyệt HĐ trên engine cho "Việc của tôi" (cờ bật); tắt ⇒ vắng. */
  myApprovals?: ReturnType<typeof myApprovals>;
  /** CR-101 DOC-deals-fix: mở lượt duyệt cấp 1 cho HĐ vừa về Chờ duyệt (nâng giao dịch khi bật duyệt). */
  /** CR-127 NF1 · "Gửi sẽ có quy trình khớp?" — cùng `flowOf` của lệnh Gửi; chi tiết HĐ dùng cho `submit_block`. */
  submitFlowOpen: (who: PackWho, id: string) => Promise<boolean>;
};
export type ContractsFlowDeps = EsignHooks & {
  ai: AiClient;
  /** M3 · D3-04 · PDF có lớp chữ ⇒ chữ (FileBox + unpdf); vắng ⇒ tệp đi thẳng agent (`AGENT_UNAVAILABLE`). */
  fileText?: SourceFileText;
  /** CR-122 p9 · bytes tệp gốc ở FileBox để đính kèm lượt AI (PDF scan / ảnh đọc bằng thị giác); vắng ⇒ `AGENT_UNAVAILABLE`. */
  fileBytes?: FileContent;
  groups: ApprovalGroups & Pick<FlowGroups, "existingIds" | "list">;
  /** contract-flow S3a · cầu engine quy trình (`packRuns`, cổng gắn lúc engine mount); vắng ⇒ không chạy duyệt trên engine. */
  engine?: ApprovalEngineBridge;
  redis?: Redis;
  quota: ActionQuota;
  tenants: SweepDeps["tenants"];
  signal?: AbortSignal;
  /** V2-A · múi giờ tenant (ngày lịch cho mốc mặc định); vắng ⇒ múi mặc định. */
  timeZoneOf?: (tenantId: string) => Promise<string>;
};
