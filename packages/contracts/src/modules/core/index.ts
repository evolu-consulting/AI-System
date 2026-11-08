// CR-125 · m1 · MOD-FR-05 · module `core`: bước cơ bản (kind "base") — Duyệt, Nếu, Kết thúc + node bảng lõi CR-122 (Gửi email, Thông báo chuông,
// Hẹn giờ, Chờ khoảng). Khoá `stage.node` của 4 node bảng GIỮ NGUYÊN (def đã lưu). Duyệt / Nếu / Kết thúc là bước có sẵn của trình sửa,
// không có stage mẫu (`stages: []`) ⇒ không vào bảng node (`CORE_NODES`), chỉ để khớp def cũ theo `baseExecutor`.

import { z } from "zod";
import { WAIT_OFFSET_DAYS, WaitTimeSchema } from "../../chat/processes";
import { ApproveParallelSchema } from "../../hub-admin/process-approve";
import type { FeatureModule, FeatureNodeDecl, PortSchema } from "../types";

const WaitUntilPort = z.strictObject({
  offset_days: z.number().int().min(WAIT_OFFSET_DAYS.min).max(WAIT_OFFSET_DAYS.max),
  time: WaitTimeSchema,
});

const native = (
  key: string,
  vi: string,
  en: string,
  baseExecutor: string,
  outputs: FeatureNodeDecl["outputs"] = [],
): FeatureNodeDecl => ({
  key,
  label: { vi, en },
  group: "message",
  kind: "base",
  baseExecutor,
  stages: [],
  inputs: [],
  outputs,
});

/** CR-125 · m8 · Duyệt: máy chủ ghi `decision` + `decided_by` + `feedback` vào dữ liệu của bước khi người duyệt quyết (`gates/approve-out.ts`). */
export const APPROVE_OUTPUTS: FeatureNodeDecl["outputs"] = [
  {
    key: "decision",
    type: "string",
    required: true,
    label: { vi: "Kết quả duyệt", en: "Approval decision" },
  },
  {
    key: "decided_by",
    type: "string",
    required: false,
    label: { vi: "Người duyệt", en: "Approver" },
  },
  {
    key: "feedback",
    type: "string",
    required: false,
    label: { vi: "Góp ý của người duyệt", en: "Approver feedback" },
  },
];

/**
 * CR-125 · «A + B cùng duyệt»: cổng cấu hình của Duyệt = `after.parallel` của stage (vắng = một nhóm duyệt như cũ). Hình dạng ở
 * `ApproveParallelSchema` (một nguồn với def); luật số nhóm / `min` ở `parallelStageIssues` (PARALLEL_GROUPS_MIN2 · PARALLEL_RULE_INVALID).
 */
export const APPROVE_CONFIG_PORT = {
  schema: z.strictObject({ parallel: ApproveParallelSchema.optional() }),
  widgets: { parallel: "department" },
} as const satisfies PortSchema;

/** Thông báo (chuông / email): người nhận thật sự được gửi tới (CR-125 m9 · node `notify` ghi tên người nhận vào output). */
const NOTIFY_OUTPUTS: FeatureNodeDecl["outputs"] = [
  {
    key: "sent_to",
    type: "string",
    required: false,
    label: { vi: "Người nhận thông báo", en: "Notified recipients" },
  },
];

export const CORE_MODULE: FeatureModule = {
  app: "core",
  events: [],
  nodes: [
    {
      key: "core.email",
      label: { vi: "Gửi email", en: "Send email" },
      group: "message",
      menu: { section: "business", order: 50 },
      kind: "base",
      baseExecutor: "notify",
      stages: [
        {
          executor: {
            kind: "notify",
            to: [{ who: "starter" }],
            channels: ["bell", "email"],
            title: "",
            body: "",
          },
        },
      ],
      inputs: [],
      outputs: NOTIFY_OUTPUTS,
    },
    {
      key: "core.bell",
      label: { vi: "Thông báo chuông", en: "In-app notification" },
      group: "message",
      menu: { section: "business", order: 40 },
      kind: "base",
      baseExecutor: "notify",
      stages: [
        {
          executor: {
            kind: "notify",
            to: [{ who: "starter" }],
            channels: ["bell"],
            title: "",
            body: "",
          },
        },
      ],
      inputs: [],
      outputs: NOTIFY_OUTPUTS,
    },
    {
      key: "core.wait-until",
      label: { vi: "Hẹn giờ", en: "Wait until date" },
      group: "timing",
      kind: "base",
      baseExecutor: "wait_until",
      configPort: { schema: WaitUntilPort, widgets: { offset_days: "days", time: "text" } },
      stages: [{ executor: { kind: "wait_until", offset_days: 0, time: "09:00" } }],
      inputs: [
        {
          key: "date",
          type: "date",
          required: true,
          label: { vi: "Ngày hẹn", en: "Target date" },
          fix: {
            vi: "thêm bước tạo «Ngày hẹn» trước, hoặc chọn «Bắt đầu khi» có ngày.",
            en: "add a step that provides the target date first, or pick a trigger that has a date.",
          },
        },
      ],
      outputs: [],
    },
    {
      key: "core.wait-for",
      label: { vi: "Chờ khoảng", en: "Wait for" },
      group: "timing",
      kind: "base",
      baseExecutor: "wait_for",
      stages: [{ executor: { kind: "wait_for", hours: 24 } }],
      inputs: [],
      outputs: [],
    },
    {
      ...native("core.approve", "Duyệt", "Approve", "approve", APPROVE_OUTPUTS),
      configPort: APPROVE_CONFIG_PORT,
    },
    native("core.if", "Nếu", "If", "if"),
    // Kết thúc = stage `set` mang `outcome` (xem `baseNodeOf`).
    native("core.end", "Kết thúc", "End", "set"),
  ],
};
