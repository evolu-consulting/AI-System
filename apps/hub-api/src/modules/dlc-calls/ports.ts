// dlc-engine · cổng của module dlc-calls: chuẩn bị run `@agent` (cùng chữ ký `PrepareMention` của runs.routes, khai báo lại
// ở đây để service không phụ thuộc tầng HTTP).
import type { AuthUser } from "../../lib/auth.middleware";
import type { MentionPlan, MentionRouted } from "../mention/public";

export type PrepareMention = (u: AuthUser, routed: MentionRouted) => Promise<MentionPlan>;
