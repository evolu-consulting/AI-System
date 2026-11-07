// CR-125 · m1 · MOD-FR-05 · module `core`: bước cơ bản (kind "base") — Duyệt, Nếu, Kết thúc + node bảng lõi CR-122 (Gửi email, Thông báo chuông,
// Hẹn giờ, Chờ khoảng). Khoá `stage.node` của 4 node bảng GIỮ NGUYÊN (def đã lưu). Duyệt / Nếu / Kết thúc là bước có sẵn của trình sửa,
// không có stage mẫu (`stages: []`) ⇒ không vào bảng node (`CORE_NODES`), chỉ để khớp def cũ theo `baseExecutor`.

import { z } from "zod";
import { WAIT_OFFSET_DAYS, WaitTimeSchema } from "../../chat/processes";
import type { FeatureModule, FeatureNodeDecl } from "../types";

const WaitUntilPort = z.strictObject({
  offset_days: z.number().int().min(WAIT_OFFSET_DAYS.min).max(WAIT_OFFSET_DAYS.max),
  time: WaitTimeSchema,
});

const native = (key: string, vi: string, en: string, baseExecutor: string): FeatureNodeDecl => ({
  key,
  label: { vi, en },
  group: "message",
  kind: "base",
  baseExecutor,
  stages: [],
  inputs: [],
  outputs: [],
});

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
      outputs: [],
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
      outputs: [],
    },
    {
      key: "core.wait-until",
      label: { vi: "Hẹn giờ", en: "Wait until date" },
      group: "timing",
      kind: "base",
      baseExecutor: "wait_until",
      configPort: { schema: WaitUntilPort, widgets: { offset_days: "days", time: "text" } },
      stages: [{ executor: { kind: "wait_until", offset_days: 0, time: "09:00" } }],
      inputs: [{ key: "date", type: "date", required: true }],
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
    native("core.approve", "Duyệt", "Approve", "approve"),
    native("core.if", "Nếu", "If", "if"),
    // Kết thúc = stage `set` mang `outcome` (xem `baseNodeOf`).
    native("core.end", "Kết thúc", "End", "set"),
  ],
};
