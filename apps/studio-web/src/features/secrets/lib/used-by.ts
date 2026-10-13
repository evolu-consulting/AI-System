// HUB-FR-68 · nhãn tham chiếu `used_by` (contract chỉ có `type` + `key`).
import type { SecretUsedBy } from "@ai/contracts/hub-admin";

const TYPE_KEY = { provider: "provider", source: "source", knowledge_hub: "kh" } as const;

export const usedByLabel = (
  t: (k: string, o?: Record<string, string>) => string,
  u: SecretUsedBy,
) => t(`secrets.usedBy.${TYPE_KEY[u.type]}`, { key: u.key });
