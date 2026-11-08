// Các mục Cài đặt lưu RIÊNG (không dùng bản nháp chung): dò giá, quy trình duyệt, điểm uy tín, CR-125 · S2: mục "Ứng dụng & quy trình" đã gộp vào "Quy trình duyệt" (một cửa).
import type { SectionId } from "../lib/types";
import { FlowCurrentPane } from "./FlowCurrentPane";
import { ScoringPane } from "./ScoringPane";
import { ScoutPane } from "./ScoutPane";

export function SectionPanes({ sec, owner }: { sec: SectionId; owner: boolean }) {
  if (sec === "scout") return <ScoutPane />;
  if (sec === "flow") return <FlowCurrentPane owner={owner} />;
  if (sec === "rep") return <ScoringPane owner={owner} />;
  return null;
}
