// dlc-engine · tool của gói `dlc`: `dlc-step` (stage `tool` của khe DLC — engine gọi, tham số hằng do khe biên dịch) và
// `dlc-start` (dlc-agent gọi trong Chat qua `/mcp`: mở lượt DLC gắn ĐÚNG hội thoại đang chat). Không `side_effect` (việc nội bộ
// workspace DLC; cổng duyệt deploy nằm ở bước báo cáo của quy trình). Quyền: người gọi cần quyền ghi gói `dlc` (Group của gói).
import type { PackToolDef } from "../../kit/application/pack-tools.ports";
import { PackToolBusinessError } from "../../kit/domain/pack-tool-error";
import type { AgentHubBridge } from "../application/ports";
import { runDlcStep } from "../application/run-step.usecase";
import type { StartRequest, StartResult } from "../application/start-flow.usecase";
import type { StepDeps } from "../application/step-context";
import {
  DLC_ACTIONS,
  DLC_MODES,
  DLC_PACK,
  DLC_TOOL_KEY,
  type DlcMode,
} from "../domain/dlc-flow.rules";

type Start = (
  u: { userId: string; tenantId: string; role: string },
  r: StartRequest,
) => Promise<StartResult>;

const stepTool = (d: StepDeps): PackToolDef => ({
  pack: DLC_PACK,
  name: DLC_TOOL_KEY,
  description:
    "Một bước của quy trình DLC (khởi tạo, spec, QC, chuẩn bị đội, build theo queue, nghiệm thu, báo cáo, deploy, agent). Chỉ chạy trong stage của lượt DLC.",
  side_effect: false,
  action: "write",
  params: [
    { name: "action", type: "select", required: true, options: DLC_ACTIONS },
    { name: "mode", type: "select", required: true, options: DLC_MODES },
    { name: "step", type: "text", required: true },
    { name: "agent", type: "text", required: false },
    { name: "instruction", type: "paragraph", required: false },
    { name: "rounds", type: "number", required: false },
  ],
  run: runDlcStep(d),
});

const startTool = (hub: AgentHubBridge, start: Start): PackToolDef => ({
  pack: DLC_PACK,
  name: "dlc-start",
  description:
    "Mở quy trình DLC (New System / Enhancement / Bug Fix) cho một ticket Trello hoặc một yêu cầu, gắn vào hội thoại hiện tại. Truyền `ticket_id` (từ dlc-tickets) hoặc `project` + `requirement`; `flow` để trống ⇒ theo ticket (lỗi ⇒ bug-fix, còn lại enhancement). Trả id lượt; các câu hỏi và bước duyệt hiện trong hội thoại.",
  side_effect: false,
  action: "write",
  params: [
    {
      name: "ticket_id",
      type: "text",
      required: false,
      description: "Ticket Trello trong workspace DLC (t-xxxx)",
    },
    {
      name: "project",
      type: "text",
      required: false,
      description: "Project workspace DLC (bỏ trống ⇒ theo ticket)",
    },
    {
      name: "requirement",
      type: "paragraph",
      required: false,
      description: "Yêu cầu / mô tả lỗi dạng chữ",
    },
    { name: "flow", type: "select", required: false, options: DLC_MODES },
  ],
  async run(ctx, args) {
    const port = hub.port;
    if (!port || !ctx.runId)
      throw new PackToolBusinessError("dlc-start: chỉ gọi được từ agent trong Chat");
    const job = await port.jobContext(ctx.tenantId, ctx.runId);
    if (!job?.conversationId || job.userId !== ctx.userId)
      throw new PackToolBusinessError("dlc-start: không tìm thấy hội thoại của lời gọi");
    const flow = String(args.flow ?? "");
    const r = await start(
      { userId: ctx.userId, tenantId: ctx.tenantId, role: job.role },
      {
        mode: (DLC_MODES as readonly string[]).includes(flow) ? (flow as DlcMode) : null,
        project: String(args.project ?? "") || null,
        ticketId: String(args.ticket_id ?? "") || null,
        requirement: String(args.requirement ?? "") || null,
        conversationId: job.conversationId,
      },
    );
    return { ...r };
  },
});

export const dlcTools = (d: StepDeps, start: Start): PackToolDef[] => [
  stepTool(d),
  startTool(d.hub, start),
];
