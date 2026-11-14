// CR-148 · luật thuần của thẻ người: gộp id cần đọc thành lô ≤ 50 (hub `GET /people?ids=`, trần PEOPLE_BATCH_MAX), bỏ id đã có / đang đọc.
import { PEOPLE_BATCH_MAX } from "@ai/contracts/people";

export function missingBatches(
  ids: readonly string[],
  have: (id: string) => boolean,
  max = PEOPLE_BATCH_MAX,
): string[][] {
  const todo = [...new Set(ids)].filter((id) => id && !have(id));
  const out: string[][] = [];
  for (let i = 0; i < todo.length; i += max) out.push(todo.slice(i, i + max));
  return out;
}
