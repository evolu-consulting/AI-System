// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến môi trường của runner e2e (không khai báo trong turbo)
// CR-127 Z7 · quy trình «Quản trị duyệt bài» của công ty test dựng từ SƠ ĐỒ TRỐNG qua đường platform (không còn gán mẫu dùng chung):
// (nhóm duyệt = nhóm chủ gói `community-owner`, do bật gói tạo) `POST company-flows {from:"blank"}` → PUT bước Duyệt (nhóm chủ gói) + Hiện/Ẩn bài → «áp dụng». Chạy lại được (đã có tên thì bỏ qua).
import { apiLogin, companyFlows, tenantIdByKey } from "../_kit/api";
import { approve, createCompanyFlow, finish } from "../_kit/flows";
import { TENANT } from "./_stack";

export const MODERATION_FLOW = "Quản trị duyệt bài";

export async function ensureModerationFlow(): Promise<void> {
  const api = process.env.CS_API_URL ?? "";
  const hub = process.env.CS_HUB_URL ?? "";
  const s = await apiLogin({
    base: api,
    tenantKey: "platform",
    username: process.env.SEED_ADMIN_USERNAME ?? "",
    password: process.env.SEED_ADMIN_PASSWORD ?? "",
  });
  const tid = await tenantIdByKey(api, s, TENANT);
  if ((await companyFlows(hub, s, tid)).some((f) => f.name === MODERATION_FLOW)) return;
  await createCompanyFlow(hub, s.token, tid, {
    name: MODERATION_FLOW,
    app: "community",
    event: "post.created",
    inputs: [{ key: "post_id", label: "Bài", type: "text", required: true }],
    stages: [
      approve("duyet-bai", "Quản trị duyệt bài", 0, "community-owner", { reject: 2, ret: 2 }),
      finish("hien-bai", "Hiện bài", 1, "shown"),
      finish("an-bai", "Ẩn bài", 2, "hidden"),
    ],
  });
}
