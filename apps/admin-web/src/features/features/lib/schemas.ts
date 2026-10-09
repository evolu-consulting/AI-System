// ADM-FR-30 · ADM-BR-10 · M2-R19, R20 · schema form feature; hằng số từ @ai/contracts, thông điệp là KEY i18n (plan-frontend §4).
import {
  CATALOG_KEY_RE,
  FEATURE_DESC_MAX,
  FEATURE_ICON_RE,
  FEATURE_NAME_MAX,
  FEATURE_STATUSES,
  type FeatureCreateRequest,
  type FeatureDetail,
  type FeatureUpdateRequest,
} from "@ai/contracts";
import { z } from "zod";

export type LocalizedValue = { vi: string; en: string };
export type FeatureFormValues = {
  key: string;
  name: LocalizedValue;
  description: LocalizedValue;
  icon: string;
  status: (typeof FEATURE_STATUSES)[number];
  /** Danh sách command của feature là **nháp**, lưu chung với tab Thông tin (Y2). */
  command_ids: string[];
};

const name = z.object({
  vi: z
    .string()
    .trim()
    .min(1, "features.error.nameRequired")
    .max(FEATURE_NAME_MAX, "features.error.nameRequired"),
  en: z.string().trim().max(FEATURE_NAME_MAX, "features.error.nameRequired"),
});
const description = z.object({
  vi: z.string().trim().max(FEATURE_DESC_MAX, "features.error.descMax"),
  en: z.string().trim().max(FEATURE_DESC_MAX, "features.error.descMax"),
});

export const featureSchema = z.object({
  key: z.string().trim().toLowerCase().regex(CATALOG_KEY_RE, "features.error.keyFormat"),
  name,
  description,
  icon: z.string().regex(FEATURE_ICON_RE),
  status: z.enum(FEATURE_STATUSES),
  command_ids: z.array(z.string()),
});

export const emptyFeatureForm = (): FeatureFormValues => ({
  key: "",
  name: { vi: "", en: "" },
  description: { vi: "", en: "" },
  icon: "package",
  status: "on",
  command_ids: [],
});

export function toFormValues(f: FeatureDetail): FeatureFormValues {
  return {
    key: f.key,
    name: { vi: f.name.vi, en: f.name.en ?? "" },
    description: { vi: f.description.vi ?? "", en: f.description.en ?? "" },
    icon: f.icon,
    status: f.status,
    command_ids: f.commands.map((c) => c.id),
  };
}

const nameBody = (v: LocalizedValue) => {
  const en = v.en.trim();
  return en ? { vi: v.vi.trim(), en } : { vi: v.vi.trim() };
};

/** Mô tả: bỏ khoá rỗng (cả hai rỗng → `{}`). */
const descBody = (v: LocalizedValue) => {
  const vi = v.vi.trim();
  const en = v.en.trim();
  return { ...(vi ? { vi } : {}), ...(en ? { en } : {}) };
};

export function toCreateBody(v: FeatureFormValues): FeatureCreateRequest {
  return {
    key: v.key.trim().toLowerCase(),
    name: nameBody(v.name),
    description: descBody(v.description),
    icon: v.icon,
    status: v.status,
    command_ids: v.command_ids,
  };
}

/** `core` không gửi `status` (server bảo vệ, `CORE_FEATURE_PROTECTED`); key bất biến nên không có. */
export function toUpdateBody(
  v: FeatureFormValues,
  version: number,
  isCore: boolean,
): FeatureUpdateRequest {
  return {
    version,
    name: nameBody(v.name),
    description: descBody(v.description),
    icon: v.icon,
    ...(isCore ? {} : { status: v.status }),
    command_ids: v.command_ids,
  };
}

export type OrphanCandidate = { id: string; name: string; feature_count: number };

/** Command bị bỏ khỏi nháp mà chỉ thuộc feature này → sẽ "chưa gắn feature" (chỉ cảnh báo, CR-055). */
export function removedOrphans(
  initial: readonly OrphanCandidate[],
  draftIds: readonly string[],
): OrphanCandidate[] {
  const keep = new Set(draftIds);
  return initial.filter((c) => !keep.has(c.id) && c.feature_count === 1);
}
