// dlc-dify · quy trình DLC trên Dify (New System / Enhancement / Bug Fix). Mỗi bước giao cho một agent Agent Hub qua
// `POST <hub>/dify/agent-calls` (Hub giữ request tới khi agent XONG, kể cả khi agent hỏi user / xin duyệt trong Chat —
// flow đứng chờ = pause, user trả lời = resume). Code thật nằm trong workspace DLC (`apps/dlc-workspace`: repo git + queue
// mỗi project). Pha:
//   P0 khởi tạo — project workspace (gắn hội thoại), spec từ file (pdf/md…) + lời user / ticket Trello, lưu artifact;
//   P1 thiết kế (Loop ≤ 4) — dlc-spec: phân tích, hỏi khi chưa rõ, trình plan + domain agent + QC agent → user duyệt;
//      dlc-qc: test case + test plan → user duyệt → viết script test chạy được, commit. QC trả "back" ⇒ quay lại spec;
//   P2 sinh agent domain (mẫu dlc-build) + QC (mẫu dlc-qc) từ plan đã duyệt; đặt lệnh test; đưa task vào queue;
//   P3 build (Loop ≤ 60) — lấy việc kế (một việc/lần), domain agent làm trên nhánh riêng, `integrate` = merge TUẦN TỰ vào
//      main + chạy test; lỗi ⇒ việc về đầu queue cho dev agent làm lại (lùi bước), tối đa 3 lần;
//   P4 nghiệm thu — dlc-verify đối chiếu 100% spec; thiếu ⇒ việc sửa vào queue + build thêm một vòng (Loop);
//   P5 báo cáo — việc `ready_to_deploy` chờ người deploy (deploy nằm ngoài DLC).
import { app, end, type Node, type StartVar, start } from "./dsl";
import { buildLoop, finalVerifyPhase, reportPhase, verifyPhase } from "./process-build";
import { designPhase, initPhase, setupPhase } from "./process-design";
import type { ProcessSpec } from "./process-kit";

export type { ProcessSpec } from "./process-kit";

export const PROCESSES: ProcessSpec[] = [
  {
    key: "dlc-new-system",
    name: "DLC · New System",
    mode: "new-system",
    title: "New System",
    toolDescription:
      "Quy trình DLC New System: dựng một hệ thống MỚI từ spec. Truyền `project` (id project đã khởi tạo bằng dlc-project-init) và/hoặc `requirement` (spec dạng chữ). File spec đính kèm phải được lưu trước bằng dlc-spec-upload (mỗi file một lần); quy trình tự đọc các file đã lưu, kể cả khi chạy lại. Chạy rất lâu, có các bước xin user trả lời/duyệt trong Chat — gọi MỘT lần và chờ.",
  },
  {
    key: "dlc-enhancement",
    name: "DLC · Enhancement",
    mode: "enhancement",
    title: "Enhancement",
    toolDescription:
      "Quy trình DLC Enhancement: thêm/đổi MỘT tính năng trên hệ thống ĐÃ CÓ (project đã có trong workspace DLC). Truyền `project`, và `requirement` (chỉ phần hành vi mới/thay đổi) hoặc `ticket_id` (ticket Trello). Chạy lâu, có bước xin user duyệt trong Chat — gọi MỘT lần và chờ.",
  },
  {
    key: "dlc-bug-fix",
    name: "DLC · Bug Fix",
    mode: "bug-fix",
    title: "Bug Fix",
    toolDescription:
      "Quy trình DLC Bug Fix: sửa MỘT lỗi trên hệ thống đã có. Truyền `project` và `requirement` (tiêu đề, cách tái hiện, mong đợi, thực tế) hoặc `ticket_id` (ticket Trello). Chạy lâu, có bước xin user duyệt trong Chat — gọi MỘT lần và chờ.",
  },
];

export const PROCESS_VARS: StartVar[] = [
  { name: "project", kind: "text-input", required: true, label: "Id project (workspace DLC + KH)" },
  { name: "requirement", kind: "paragraph", label: "Spec / yêu cầu dạng chữ" },
  { name: "ticket_id", kind: "text-input", label: "Ticket Trello (tuỳ chọn)" },
  { name: "hub_ticket", kind: "text-input", label: "Vé gọi ngược Hub (Hub tự điền)" },
  { name: "hub_conversation_id", kind: "text-input", label: "Hội thoại (Hub tự điền)" },
  { name: "hub_async", kind: "text-input", label: "Chạy nền (Hub tự điền)" },
];

/** Tiện ích Python dùng chung trong node code. */
export type FlowEnv = { hubUrl: string; wsUrl: string; wsToken: string };

export function processDsl(p: ProcessSpec, e: FlowEnv): Record<string, unknown> {
  const nodes: Node[] = [
    start(PROCESS_VARS),
    ...initPhase(p),
    designPhase(p),
    ...setupPhase(),
    buildLoop("build", "P3 · Build theo queue (tuần tự)", "spawn_dev"),
    ...verifyPhase(p),
    buildLoop("fix", "P4 · Sửa theo nghiệm thu", "spawn_dev"),
    ...finalVerifyPhase(p),
    ...reportPhase(p),
    end({ text: ["report", "text"] }),
  ];
  return app({
    name: p.key,
    description: p.toolDescription,
    envVars: { hub_url: e.hubUrl, ws_url: e.wsUrl, ws_token: e.wsToken },
    nodes,
  });
}
