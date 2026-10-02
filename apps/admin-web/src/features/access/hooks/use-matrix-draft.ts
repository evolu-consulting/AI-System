// ADM-FR-35 · M3-R08 · nháp ma trận: Map chênh lệch so với bản đã lưu; tick ô/hàng/cột, đếm thay đổi, huỷ.
import type { MatrixFeature, MatrixGroup } from "@ai/contracts";
import { useCallback, useMemo, useState } from "react";
import {
  countChanges,
  type Draft,
  EMPTY_DRAFT,
  type MatrixModel,
  toggleCell,
  toggleCol,
  toggleRow,
} from "../lib/matrix";

export function useMatrixDraft(model: MatrixModel | null) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const apply = useCallback(
    (fn: (m: MatrixModel, d: Draft) => Draft) => model && setDraft((d) => fn(model, d)),
    [model],
  );
  const cell = useCallback(
    (f: MatrixFeature, g: MatrixGroup) => apply((m, d) => toggleCell(m, d, f, g)),
    [apply],
  );
  const row = useCallback((f: MatrixFeature) => apply((m, d) => toggleRow(m, d, f)), [apply]);
  const col = useCallback((g: MatrixGroup) => apply((m, d) => toggleCol(m, d, g)), [apply]);
  const count = useMemo(() => (model ? countChanges(model, draft) : 0), [model, draft]);
  return { draft, count, cell, row, col, reset: () => setDraft(EMPTY_DRAFT) };
}
