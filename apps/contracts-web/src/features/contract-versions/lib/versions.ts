// CR-097 K3b: logic thuần của khối "Phiên bản hợp đồng" — loại dòng, điều kiện nút, số phiên bản thay thế, dòng so sánh, lỗi.
import type { ContractVersionRef } from "@ai/contracts";

export type VersionKind = "superseded" | "draft" | "current";
export const KIND_ICON: Record<VersionKind, string> = {
  superseded: "📄",
  draft: "✏",
  current: "🔒",
};

/** Đã thay ⇒ superseded; chưa thay mà lớn hơn bản hiện hành (nhỏ nhất chưa bị thay) ⇒ nháp; còn lại hiện hành. */
export function versionKind(
  v: ContractVersionRef,
  all: readonly ContractVersionRef[],
): VersionKind {
  if (v.superseded_at) return "superseded";
  const live = all.filter((x) => !x.superseded_at).map((x) => x.version_no);
  return live.length > 0 && v.version_no > Math.min(...live) ? "draft" : "current";
}

/** Nút "Tải bản cập nhật": đã khoá, chưa bị thay, chưa có bản lớn hơn (nháp). */
export const canUploadUpdate = (c: {
  locked: boolean;
  superseded_at: string | null;
  version_no: number;
  versions: readonly { version_no: number }[];
}): boolean =>
  c.locked && c.superseded_at == null && !c.versions.some((v) => v.version_no > c.version_no);

/** Banner "Đã thay thế bởi Phiên bản N"; null khi không bị thay. */
export function supersededInfo(c: {
  superseded_at: string | null;
  superseded_by: string | null;
  current_id: string | null;
  versions: readonly { id: string; version_no: number }[];
}): { byNo: number | null; currentId: string | null } | null {
  if (!c.superseded_at) return null;
  const by = c.versions.find((v) => v.id === c.superseded_by);
  return { byNo: by?.version_no ?? null, currentId: c.current_id };
}

export const showVersionBadge = (versionsCount: number): boolean => versionsCount > 1;

/** Mặc định so sánh: hai phiên bản lớn nhất (a = cũ hơn). */
export function defaultPair(vs: readonly ContractVersionRef[]): [string, string] | null {
  if (vs.length < 2) return null;
  const s = [...vs].sort((x, y) => x.version_no - y.version_no);
  return [s[s.length - 2]?.id ?? "", s[s.length - 1]?.id ?? ""];
}

const show = (v: unknown): string => {
  if (v == null || v === "") return "—";
  if (typeof v === "object") {
    const o = v as { value?: unknown };
    return "value" in o ? show(o.value) : JSON.stringify(v);
  }
  return String(v);
};

export type DiffRow = { key: string; a: string; b: string };
export const diffRows = (changes: readonly { key: string; a: unknown; b: unknown }[]): DiffRow[] =>
  changes.map((c) => ({ key: c.key, a: show(c.a), b: show(c.b) }));

const ERR_KEY: Record<string, string> = {
  CONTRACT_SUPERSEDED: "contracts.versions.err.superseded",
  VERSION_DRAFT_EXISTS: "contracts.versions.err.draftExists",
  CONTRACT_HAS_VERSIONS: "contracts.versions.err.hasVersions",
  VERSION_NOT_ALLOWED: "contracts.versions.err.notAllowed",
  CONTRACT_NOT_LOCKED: "contracts.versions.err.notLocked",
};
/** Mã lỗi API ⇒ khoá i18n thân thiện; lạ ⇒ lỗi chung. */
export const versionErrorKey = (code: string | undefined): string =>
  (code && ERR_KEY[code]) || "contracts.versions.err.generic";
