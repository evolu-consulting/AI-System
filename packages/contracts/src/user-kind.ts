// CR-102a · ADM-FR-74 · loại user: `internal` (nhân viên tenant) / `external` (đối tác, thuộc `admin.external_orgs`).
// Vắng (token/DTO cũ) ⇒ coi là `internal`.
import { z } from "zod";

export const USER_KINDS = ["internal", "external"] as const;
export const UserKindSchema = z.enum(USER_KINDS);
export type UserKind = z.infer<typeof UserKindSchema>;
