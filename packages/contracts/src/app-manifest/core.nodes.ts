// CR-122 · FLOW2-FR-25 · node LÕI của nền tảng trên bảng node (mọi công ty đều có, không khoá tính năng): Gửi email, Thông báo
// chuông (executor `notify`), Hẹn giờ (`wait_until`), Chờ khoảng (`wait_for`). Chỉ là cấu hình đặt sẵn — không executor mới.
import type { AppNodeDecl } from "./manifest";

export const CORE_NODES: readonly AppNodeDecl[] = [
  {
    key: "core.email",
    label: { vi: "Gửi email", en: "Send email" },
    group: "message",
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
    stages: [{ executor: { kind: "wait_until", offset_days: 0, time: "09:00" } }],
    inputs: [{ key: "date", type: "date", required: true }],
    outputs: [],
  },
  {
    key: "core.wait-for",
    label: { vi: "Chờ khoảng", en: "Wait for" },
    group: "timing",
    stages: [{ executor: { kind: "wait_for", hours: 24 } }],
    inputs: [],
    outputs: [],
  },
];
