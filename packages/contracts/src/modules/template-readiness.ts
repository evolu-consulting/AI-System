// CR-125 · c5 · MỘT luật THUẦN "mẫu Thư viện dùng được ở công ty chưa" (không I/O): tính năng cần (MODULES `feature` của node), tool cần
// (stage tool), nhóm duyệt cần (`group_key`), thứ tự node (`requires`). Dùng chung cho: platform gán mẫu cho công ty, công ty sao chép mẫu,
// seed/onboard (D7). Công ty KHÔNG BAO GIỜ nhận mẫu mà không áp dụng được.
import { featureNodeByKey } from "./modules.rules";
import type { FeatureModule } from "./types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export type TemplateNeeds = {
  /** Tính năng cần bật cho công ty (mỗi khoá một dòng, kèm bước đòi nó). */
  features: { key: string; stage: string }[];
  /** Tool (khoá) của các stage `tool`, kèm tên bước. */
  tools: { key: string; stage: string }[];
  /** Mã nhóm duyệt mà mẫu trỏ tới. */
  groups: string[];
  /** Bước đặt sai thứ tự theo `requires` của node (vd gửi ra ngoài trước khi có bước Duyệt). */
  order: { node: string; stage: string; needs: "approval" }[];
  /** Bước CỐ ĐỊNH của nền tảng (khe `slot`): chạy được khi được gán nhưng không sửa/lưu được trên bản sao của công ty. */
  locked: string[];
};

export type TenantSide = {
  /** Khoá tính năng đang bật cho công ty. */
  features: ReadonlySet<string>;
  /** Khoá tool khả dụng cho công ty. */
  tools: ReadonlySet<string>;
  /** Mã nhóm hiện có ở công ty. */
  groupKeys: readonly string[];
};

export type TemplateReadiness = {
  /** Không thiếu tính năng/tool/thứ tự — nhóm thiếu KHÔNG chặn (bước mở ra "Chọn người duyệt"). */
  ready: boolean;
  missing: {
    features: { key: string; stage: string }[];
    tools: { key: string; stage: string }[];
    groups: string[];
    order: TemplateNeeds["order"];
  };
  /** Mã nhóm của mẫu → mã nhóm có thật ở công ty (đã khớp theo tên/loại). Mã không có ở đây = chưa có nhóm. */
  groupMap: Record<string, string>;
  /** Câu tiếng Việt nói thiếu gì và ai cần làm gì; rỗng khi ready. */
  reasons: string[];
  /** Sao chép để sửa được: ready và không có bước cố định của nền tảng. */
  copyable: boolean;
  /** Lý do không sao chép được (gồm `reasons` + bước cố định). */
  copyReasons: string[];
};

const nameOf = (s: Obj): string => (typeof s.name === "string" && s.name ? s.name : String(s.key));

function groupKeysOfStage(s: Obj): string[] {
  const out: string[] = [];
  const one = (o: unknown) => {
    if (isObj(o) && typeof o.group_key === "string") out.push(o.group_key);
  };
  one(s.after);
  one(s.answerer);
  if (isObj(s.after)) {
    one(s.after.escalate);
    for (const k of Array.isArray(s.after.also_group_keys) ? s.after.also_group_keys : [])
      if (typeof k === "string") out.push(k);
  }
  return out;
}

/** Mẫu (stages thô) cần gì. `mods` = `MODULES`. */
export function templateNeeds(
  stages: readonly unknown[],
  mods: readonly FeatureModule[],
): TemplateNeeds {
  const needs: TemplateNeeds = { features: [], tools: [], groups: [], order: [], locked: [] };
  const groups = new Set<string>();
  stages.forEach((raw, i) => {
    if (!isObj(raw)) return;
    const stage = nameOf(raw);
    const node = typeof raw.node === "string" ? featureNodeByKey(mods, raw.node) : undefined;
    addOnce(needs.features, node?.feature, stage);
    const ex = isObj(raw.executor) ? raw.executor : {};
    // bước khe (`slot`): tool do nền tảng giữ, không đòi công ty có; chỉ là "cố định" (không sao chép sửa được)
    if (isObj(raw.slot)) needs.locked.push(stage);
    else addOnce(needs.tools, ex.kind === "tool" ? ex.tool_key : undefined, stage);
    for (const g of groupKeysOfStage(raw)) groups.add(g);
    if (node?.requires?.before === "approval" && needsApprovalBefore(stages, i))
      needs.order.push({ node: node.key, stage, needs: "approval" });
  });
  needs.groups = [...groups];
  return needs;
}

/** Node nhiều stage (Ký số = gửi + chờ): chỉ stage ĐẦU của cụm phải đứng ngay sau bước Duyệt. */
function needsApprovalBefore(stages: readonly unknown[], i: number): boolean {
  const cur = stages[i];
  const prev = stages[i - 1];
  const sameCluster =
    isObj(cur) && isObj(prev) && typeof cur.node === "string" && prev.node === cur.node;
  return !sameCluster && !isApproval(prev);
}

const isApproval = (s: unknown): boolean =>
  isObj(s) && isObj(s.executor) && s.executor.kind === "approve";

/** Thêm khoá (chuỗi) nếu chưa có trong danh sách. */
function addOnce(list: { key: string; stage: string }[], key: unknown, stage: string): void {
  if (typeof key === "string" && !list.some((x) => x.key === key)) list.push({ key, stage });
}

/**
 * Khớp mã nhóm của mẫu với nhóm CÓ THẬT của công ty: trùng mã ⇒ dùng; mẫu `<app>-admin` ⇒ nhóm chủ gói `<app>-owner`
 * (cùng loại "quản trị gói", do bật gói tạo ra). Không khớp ⇒ null (bước mở ra "Chọn người duyệt", không đoán nhóm khác).
 */
export function mapGroupKey(key: string, tenantKeys: readonly string[]): string | null {
  if (tenantKeys.includes(key)) return key;
  const m = /^(.+)-admin$/.exec(key);
  const alias = m ? `${m[1]}-owner` : null;
  return alias && tenantKeys.includes(alias) ? alias : null;
}

/** Mã nhóm có thể được `mapGroupKey` đổi ra (để repo đọc đủ trong MỘT câu SQL). */
export const groupKeyCandidates = (keys: readonly string[]): string[] => [
  ...new Set(keys.flatMap((k) => [k, /^(.+)-admin$/.test(k) ? k.replace(/-admin$/, "-owner") : k])),
];

export function templateReadiness(needs: TemplateNeeds, tenant: TenantSide): TemplateReadiness {
  const features = needs.features.filter((f) => !tenant.features.has(f.key));
  const tools = needs.tools.filter((t) => !tenant.tools.has(t.key));
  const groupMap: Record<string, string> = {};
  const groups: string[] = [];
  for (const g of needs.groups) {
    const hit = mapGroupKey(g, tenant.groupKeys);
    if (hit) groupMap[g] = hit;
    else groups.push(g);
  }
  const reasons = [
    ...features.map(
      (f) => `Bước «${f.stage}» cần tính năng «${f.key}» — quản trị nền tảng cần bật cho công ty.`,
    ),
    ...tools.map(
      (t) =>
        `Bước «${t.stage}» dùng chức năng «${t.key}» công ty chưa có — quản trị nền tảng cần bật.`,
    ),
    ...needs.order.map((o) => `Bước «${o.stage}» phải đứng ngay sau một bước Duyệt.`),
  ];
  const copyReasons = [
    ...reasons,
    ...needs.locked.map(
      (s) => `Bước «${s}» là bước cố định của nền tảng — không sửa được trên bản sao của công ty.`,
    ),
  ];
  return {
    ready: reasons.length === 0,
    missing: { features, tools, groups, order: needs.order },
    groupMap,
    reasons,
    copyable: copyReasons.length === 0,
    copyReasons,
  };
}
