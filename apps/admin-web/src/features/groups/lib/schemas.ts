// ADM-FR-62 · M3-R01 · schema form group; hằng số từ @ai/contracts, thông điệp là KEY i18n (plan-frontend §4).
import {
  GROUP_DESC_MAX,
  GROUP_KEY_RE,
  GROUP_NAME_MAX,
  type Group,
  type GroupCreateRequest,
} from "@ai/contracts";
import { z } from "zod";
import { foldKeyInput } from "@/lib/normalize";

export type LocalizedValue = { vi: string; en: string };
export type GroupFormValues = { key: string; name: LocalizedValue; description: string };

const name = z.object({
  vi: z
    .string()
    .trim()
    .min(1, "groups.error.nameRequired")
    .max(GROUP_NAME_MAX, "groups.error.nameRequired"),
  en: z.string().trim().max(GROUP_NAME_MAX, "groups.error.nameRequired"),
});
const description = z.string().trim().max(GROUP_DESC_MAX, "groups.error.descMax");

export const groupCreateSchema = z.object({
  key: z.string().trim().toLowerCase().regex(GROUP_KEY_RE, "groups.error.keyFormat"),
  name,
  description,
});
/** Hộp thoại "Đổi tên group": chỉ Tên và Mô tả (key bất biến). */
export const groupRenameSchema = z.object({ name, description });

export const emptyGroupForm = (): GroupFormValues => ({
  key: "",
  name: { vi: "", en: "" },
  description: "",
});

export const toFormValues = (g: Pick<Group, "key" | "name" | "description">): GroupFormValues => ({
  key: g.key,
  name: { vi: g.name.vi, en: g.name.en ?? "" },
  description: g.description ?? "",
});

/** Khi đang gõ: chữ thường, bỏ dấu, dấu cách → `-` (không trim, để không nuốt ký tự giữa chừng). */
export const typeGroupKey = (input: string): string => foldKeyInput(input).replace(/\s+/g, "-");

const nameBody = (v: LocalizedValue) => {
  const en = v.en.trim();
  return en ? { vi: v.vi.trim(), en } : { vi: v.vi.trim() };
};
const descBody = (v: string): string | null => (v.trim() === "" ? null : v.trim());

export function toCreateBody(v: GroupFormValues): GroupCreateRequest {
  return {
    key: v.key.trim().toLowerCase(),
    name: nameBody(v.name),
    description: descBody(v.description),
  };
}

/** Body PATCH không có `version` (nơi gọi thêm). */
export function toRenameBody(v: GroupFormValues) {
  return { name: nameBody(v.name), description: descBody(v.description) };
}
