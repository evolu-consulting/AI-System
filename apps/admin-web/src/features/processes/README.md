# admin-web · features/processes (P-a, CR-056)

Quy trình trong Evolu Control: danh sách + editor + trang lượt chạy (ADM-FR-65/66, task F5 · PF4).

- **Bước 0 (đã có):** dò cờ (`api.ts` `probeEngine`, `engine.ts` `useProcessEngine`/`useEngineRoute`), `components/ProcessRouteGate`, 3 trang stub (`pages/*`), 4 route lười ở `routes/_authed/processes/*`, nav "Quy trình" (`shell/lib/nav.ts`, chỉ khi engine `on`), `ConflictEntity` += `process_def`.
- **PF4 làm:** thân 3 trang, `api.ts` (`useProcessDefs`…), `components/**`, `hooks/**`, `components/usage/**`, chuỗi `locales/process/admin.*` (+ `usage.*` dùng chung với chat). Giữ `ProcessRouteGate` bọc mọi trang.
- Cờ off ⇒ nav ẩn, route ⇒ `NotFoundState`, không nạp chuỗi `process.*`.
- `routes/_authed/processes/$processId_.runs.$runId.tsx` dùng hậu tố `_` để KHÔNG lồng vào `$processId` (editor không có `<Outlet/>`).

## Cấu trúc (hoàn thành P-a)
| Thư mục | Nội dung |
|---|---|
| `pages/` | `ProcessesPage` (danh sách + mẫu), `ProcessEditorPage` (editor tối thiểu), `ProcessRunPage` (lượt chạy + token) |
| `components/` | `ProcessesTable`, `RunDialog`, `editor/`, `run/`, `usage/` (tab Token, nhân đôi với chat-web — TECH-DEBT) |
| `hooks/`, `lib/` | state/logic (`use-def-save`, `use-run-data`…), `def-form`, `usage-view`, `errors` |
| `api.ts`, `engine.ts` | gọi Hub duy nhất ở `api.ts`; cờ `HUB_PROCESS_ENGINE` dò bằng `probeEngine` (off ⇒ nav ẩn, route "Không tìm thấy") |

## P-b · editor Nguồn / Đầu vào (ADM-FR-69, HUB-FR-124/125, CR-060)
| File | Nội dung |
|---|---|
| `components/editor/SourcesCard`, `InputsCard`, `InputRow` | thẻ "Nguồn của quy trình" + "Thông tin đầu vào" (≤ `DEF_INPUTS_MAX`) |
| `components/editor/StageSourcesField`, `StageMustKnow` | nguồn/allowlist (≤5) + "Điều phải biết" trong giai đoạn |
| `lib/sources-form.ts` | map def⇄form cho `sources`/`inputs`/`stage.sources`/`must_know`; nối vào `def-form`/`use-draft`/`use-def-save` |
| Schema | `ProcessInputDefSchema`… import từ barrel `@ai/contracts/hub-admin` (định nghĩa ở `sources.ts`) |
| Chuỗi | `locales/process/admin.*`, `inputs.*` |

## P-b2 · Canvas theo bước (ADM-FR-71, HUB-FR-104/118, CR-063, ADR-0013)
| File | Nội dung |
|---|---|
| `lib/step-ops.ts` · `canvas-layout.ts` · `canvas-keys.ts` · `step-label.ts` | thuần + test: đổi bước/thứ tự/tách/thêm/xoá (nén bước, remap `backTo`), bố cục cột (không lưu toạ độ), phím `Alt+mũi tên`, đếm bước từ 1 |
| `lib/def-form.ts` | `StageDraft.step/backTo`, `canRealAction` theo bước, `validateSteps` (dùng `processDefStageIssues` của contract) |
| `hooks/use-draft.ts` · `use-stage-ops.ts` | `selected` (uid), thao tác bước + thông báo (`aria-live`, lỗi inline) |
| `components/editor/Stage*.tsx` | form giai đoạn tách nhỏ (#136); "Chạy ở bước", "Nếu bị trượt" ở `StageStepFields` |
| `components/canvas/StageWorkbench` + `StepList` + `StagePanel` | thẻ Giai đoạn: toolbar, tab Canvas/Danh sách, panel `complementary` |
| `components/canvas/CanvasView` → `ProcessCanvas` (lazy, chunk `canvas` + `canvas-vendor`) | xyflow 12.11.6: `StageNode`, `StepHeaderNode`, `JoinNode`, `BackEdge`; ngân sách chunk `canvas*` 80 KB ở `scripts/check-bundle.ts`; cacheGroup `canvasVendor` ở `rsbuild.config.ts` |

