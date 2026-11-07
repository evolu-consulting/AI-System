// CR-118 · @ai/flow-canvas · chữ + lớp CSS của node/cạnh do HOST cấp (gói không import i18n, không biết token riêng của app).
// Mặc định: token shadcn (có ở admin-web và workspace-web). Host đè từng khoá bằng `theme`/`labels`.
import type { ReactNode } from "react";
import type { StepInfo } from "./layout/vertical";

export type FlowLabels = {
  // vertical (sơ đồ duyệt)
  start: string;
  finalize: string;
  locked: string;
  conditional: string;
  review: string;
  esign: string;
  dify: string;
  // columns (editor)
  stepTitle: (n: number) => string;
  addToStep: (n: number) => string;
  join: (n: number) => string;
  edgeBack: string;
  edgeBranch: (rule: number) => string;
  yes: string;
  no: string;
  // khung canvas
  canvas: string | undefined;
  controls:
    | { title: string; zoomIn: string; zoomOut: string; fit: string; minimap?: string }
    | undefined;
};

export const DEFAULT_LABELS: FlowLabels = {
  start: "Start",
  finalize: "Finalize",
  locked: "Locked",
  conditional: "Conditional",
  review: "Review",
  esign: "E-sign",
  dify: "Dify",
  stepTitle: (n) => `Step ${n}`,
  addToStep: (n) => `Add stage to step ${n}`,
  join: (n) => `Wait ${n}/${n}`,
  edgeBack: "Back",
  edgeBranch: (n) => `Branch · rule ${n}`,
  yes: "Yes",
  no: "No",
  canvas: undefined,
  controls: undefined,
};

export type FlowTheme = {
  start: string;
  startIcon: string;
  finalize: string;
  finalizeIcon: string;
  lockIcon: string;
  step: string;
  stepOn: string;
  stepOff: string;
  stepIndex: string;
  stepDept: string;
  pill: string;
};

export const DEFAULT_THEME: FlowTheme = {
  start:
    "flex items-center justify-center gap-2 rounded-full border border-border bg-muted text-label font-medium",
  startIcon: "size-3.5 text-muted-foreground",
  finalize:
    "flex items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted px-3 text-label font-medium",
  finalizeIcon: "size-4 text-muted-foreground",
  lockIcon: "size-3.5 text-muted-foreground",
  step: "flex flex-col justify-center gap-1 overflow-hidden rounded-xl border bg-card px-3 py-2",
  stepOn: "border-border shadow-sm",
  stepOff: "border-dashed border-border opacity-40",
  stepIndex:
    "flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-caption text-muted-foreground",
  stepDept: "truncate text-caption text-muted-foreground",
  pill: "rounded-full bg-accent px-2 py-0.5 text-caption font-semibold text-accent-foreground",
};

/** Dòng thông tin của node bước (hạn, người duyệt, chuyển cấp…): chữ do host dịch. */
export type RenderStepInfo = (info: StepInfo) => ReactNode;
