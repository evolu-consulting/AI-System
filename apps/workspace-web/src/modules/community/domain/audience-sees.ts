// CR-191 · «Ai thấy bài» — hàm thuần không i18n. Cùng hình với hub `audience.rules.ts` (`audienceSees`); bảng chân trị dùng chung
// `tests/acceptance/com-c3/_support/audience-truth.ts` (unit web + hub + int SQL) ⇒ ba bản luật không lệch.
import type { PostAudience, PostType } from "@ai/contracts/community";
import { audienceIncludes } from "./visibility";

type Label = "supplier" | "customer";
export type AudienceViewer =
  | { kind: "internal" }
  | { kind: "partner"; orgId: string; labels: readonly Label[]; cats: string[] }
  | { kind: "connected"; tenantId: string; labels: readonly Label[] };

/** Nội bộ thấy mọi mức; đối tác trong cộng đồng theo luật cũ; công ty đã kết nối theo BR-191-1 (companies ⇒ `tenants`, không dùng ext_org). */
export function audienceSees(
  a: PostAudience,
  type: PostType,
  postCats: string[],
  v: AudienceViewer,
): boolean {
  if (v.kind === "internal") return true;
  if (v.kind === "partner")
    return audienceIncludes(a, type, postCats, { ...v, labels: [...v.labels] });
  switch (a.mode) {
    case "all":
      return true;
    case "suppliers":
      return v.labels.includes("supplier");
    case "buyers":
      return v.labels.includes("customer");
    case "companies":
      return a.tenants.includes(v.tenantId);
    default: // internal, cats
      return false;
  }
}
