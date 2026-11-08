// Các mục Cài đặt lưu RIÊNG (không dùng bản nháp chung): dò giá, quy trình duyệt, điểm uy tín, "Ứng dụng & quy trình" (CR-118 §11.2).
import type { SectionId } from "../lib/types";
import { AppsSection } from "./apps/AppsSection";
import { FlowCurrentPane } from "./FlowCurrentPane";
import { ScoringPane } from "./ScoringPane";
import { ScoutPane } from "./ScoutPane";

export function SectionPanes({
  sec,
  owner,
  appsTenantId,
  onGoFlow,
}: {
  sec: SectionId;
  owner: boolean;
  /** Có khi người dùng được thấy mục "Ứng dụng & quy trình". */
  appsTenantId: string | null;
  /** Chuyển sang mục "Quy trình duyệt" (thẻ ở mục Ứng dụng chỉ còn một dòng + liên kết này). */
  onGoFlow: () => void;
}) {
  if (sec === "scout") return <ScoutPane />;
  if (sec === "flow") return <FlowCurrentPane owner={owner} />;
  if (sec === "rep") return <ScoringPane owner={owner} />;
  if (sec === "apps") return <AppsSection tenantId={appsTenantId} onGoFlow={onGoFlow} />;
  return null;
}
