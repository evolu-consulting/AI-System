// CR-118 bundle · các bảng phụ của trang chi tiết hợp đồng nạp lười (giữ chunk route < ngân sách 50 KB sau khi bật React Compiler).
// Giữ nguyên props; chỉ đổi thời điểm tải mã. Fallback rỗng: bảng hiện ngay khi chunk về.
import { type ComponentProps, lazy, Suspense } from "react";
import type { EsignPanel as EsignPanelT } from "~/features/contract-esign/components/EsignPanel";
import type { Timeline as TimelineT } from "~/features/contract-milestones/components/Timeline";
import type { VersionsPanels as VersionsPanelsT } from "~/features/contract-versions/components/VersionsPanels";
import type { FramePanel as FramePanelT } from "~/features/frame-panel/components/FramePanel";
import type { ContractLog as ContractLogT } from "~/features/ledger/components/ContractLog";
import type { EditLogPanel as EditLogPanelT } from "~/features/promote-deal/components/EditLogPanel";
import type { HistoryPanel as HistoryPanelT } from "./HistoryPanel";

const Frame = lazy(() =>
  import("~/features/frame-panel/components/FramePanel").then((m) => ({ default: m.FramePanel })),
);
const Esign = lazy(() =>
  import("~/features/contract-esign/components/EsignPanel").then((m) => ({
    default: m.EsignPanel,
  })),
);
const Versions = lazy(() =>
  import("~/features/contract-versions/components/VersionsPanels").then((m) => ({
    default: m.VersionsPanels,
  })),
);
const Log = lazy(() =>
  import("~/features/ledger/components/ContractLog").then((m) => ({ default: m.ContractLog })),
);
const EditLog = lazy(() =>
  import("~/features/promote-deal/components/EditLogPanel").then((m) => ({
    default: m.EditLogPanel,
  })),
);
const History = lazy(() => import("./HistoryPanel").then((m) => ({ default: m.HistoryPanel })));

export const FramePanel = (p: ComponentProps<typeof FramePanelT>) => (
  <Suspense fallback={null}>
    <Frame {...p} />
  </Suspense>
);
export const EsignPanel = (p: ComponentProps<typeof EsignPanelT>) => (
  <Suspense fallback={null}>
    <Esign {...p} />
  </Suspense>
);
export const VersionsPanels = (p: ComponentProps<typeof VersionsPanelsT>) => (
  <Suspense fallback={null}>
    <Versions {...p} />
  </Suspense>
);
export const ContractLog = (p: ComponentProps<typeof ContractLogT>) => (
  <Suspense fallback={null}>
    <Log {...p} />
  </Suspense>
);
export const EditLogPanel = (p: ComponentProps<typeof EditLogPanelT>) => (
  <Suspense fallback={null}>
    <EditLog {...p} />
  </Suspense>
);
export const HistoryPanel = (p: ComponentProps<typeof HistoryPanelT>) => (
  <Suspense fallback={null}>
    <History {...p} />
  </Suspense>
);

const Time = lazy(() =>
  import("~/features/contract-milestones/components/Timeline").then((m) => ({
    default: m.Timeline,
  })),
);
export const Timeline = (p: ComponentProps<typeof TimelineT>) => (
  <Suspense fallback={null}>
    <Time {...p} />
  </Suspense>
);
