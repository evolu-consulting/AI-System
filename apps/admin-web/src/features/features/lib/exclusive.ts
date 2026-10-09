// ADM-FR-30 · M2-R21 (CR-055) · command chỉ thuộc đúng feature này (`feature_count = 1`) — sẽ "chưa gắn feature" khi xoá feature.
import type { FeatureDetail } from "@ai/contracts";

export type CommandRef = { id: string; name: string };

export function exclusive(d: FeatureDetail): CommandRef[] {
  return d.commands.filter((c) => c.feature_count === 1).map((c) => ({ id: c.id, name: c.name }));
}
