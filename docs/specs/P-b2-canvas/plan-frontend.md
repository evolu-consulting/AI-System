# P-b2 · plan frontend (admin-web canvas + chat-web) — Canvas quy trình, bước song song, quay lại

Spec: [`spec.md`](spec.md) §2 (PB2-R01…R18), §5 · ADR: [`../../adr/0013-xyflow-process-canvas.md`](../../adr/0013-xyflow-process-canvas.md) · contract (chỉ **tiêu thụ**, backend-lead sở hữu): `plan.md` §3 · câu chữ VI/EN nguyên văn: [`plan-frontend-i18n.md`](plan-frontend-i18n.md) · task: [`tasks-frontend.md`](tasks-frontend.md) · nền: `../P-b-sources/plan-frontend.md` (FS-x), `../P-process-engine/plan-frontend.md` (FD2 cờ engine, FD3 i18n riêng).
**Nguồn UI:** mockup Part B (B1 canvas admin, B2 run chat) + design system (indigo `#4F46E5`, token Tailwind sẵn có). *Ghi chú trung thực:* phiên PLAN này không đọc được Artifact (không có công cụ) — bố cục dưới đây theo mô tả spec §5/UI §7.17; người dùng đối chiếu mockup ở UAT (Q5). Không hard-code hex.
**Điều kiện mở BUILD FE:** T4 (contract) xong; xem §9 "Cần từ backend".

## 0. Quyết định (FB = frontend decision; Luật 2)
| # | Quyết định | Lý do |
|---|---|---|
| FB1 | `@xyflow/react` **12.11.6** (đăng 2026-09-01, > 6 tuần; MIT; dep `@xyflow/system` 0.0.82, `classcat`, `zustand@4`; peer react ≥ 17 ⇒ hợp React 18.3.1). Ghim đúng phiên bản (không `^`). ai-sdlc đang dùng cùng bản. Chi tiết/đo: ADR-0013 | Chạy thật bên repo anh em; bản 12.12.0 (2026-09-24) mới < 3 tuần, không cần |
| FB2 | **Chunk riêng `canvas`** (`React.lazy` + `Suspense`, magic comment `webpackChunkName: "canvas"`) nạp trong `ProcessEditorPage` (cả `/processes/:id` và `/processes/new`). Đo: xyflow ≈ **54 KB gz** JS + 2 KB CSS (`@xyflow/react/dist/base.css`, import trong chunk) + mã của ta ≈ 8–10 KB ⇒ ≈ **65 KB**: vượt trần chunk chung 50 KB ⇒ `check-bundle.ts` thêm `CANVAS_CHUNK_BUDGET_BYTES = 80 KB` cho chunk tên `canvas*`, mọi chunk khác giữ 50 KB. **Bundle tải ban đầu (150 KB JS/25 KB CSS) không đổi** | ADR-0013 #2; Q của ADM-NFR-06 |
| FB3 | **`StepList`** (DOM thuần, không xyflow): danh sách theo bước, mỗi stage là `button`. Là (a) fallback khi chunk đang tải/lỗi nạp, (b) chế độ "Danh sách" (nút chuyển Canvas/Danh sách, mặc định Danh sách khi `< 768 px`), (c) đường **bàn phím/đọc màn hình đầy đủ** không phụ thuộc kéo thả. Mọi thao tác đổi bước/thứ tự làm được ở đây và ở panel bằng nút | A11y (CONVENTIONS), xyflow không tối ưu mobile |
| FB4 | **Không lưu toạ độ.** `layoutSteps(stages)` (hàm thuần, `lib/canvas-layout.ts`) tính vị trí: cột `x = step × 320`, hàng `y = row × 120`, cột căn giữa theo cột cao nhất; node `stage` 240×88, node `stepHeader` (tiêu đề cột + nút "＋"), node `join` (chấm "Chờ đủ n/n") đặt giữa cột k và k+1 khi cột k có > 1 stage. Cạnh tiến: stage → join → mọi stage cột kế (hoặc stage → stage khi cột đơn). Cạnh quay lại: từ stage nguồn → `stepHeader` của bước đích, nét đứt (`strokeDasharray`), màu `warning`, nhãn "Quay lại" | ADR-0013 #3, PB2-R16 |
| FB5 | **Một nguồn sự thật**: `StageDraft` (lib/def-form) thêm `step: number` (luôn có trong draft: = `stage.step ?? idx` khi nạp) và `backTo: number[]`. Lưu ⇒ xuất `step` cho **mọi** stage (tránh `STEP_INCOMPLETE`). Canvas **không** giữ state riêng: nodes/edges là dẫn xuất (`useMemo`) từ `DraftState` | Tránh lệch canvas/form; đúng PB2-R14 |
| FB6 | Mọi phép đổi cấu trúc ở `lib/step-ops.ts` (thuần, có test đơn vị): `moveToStep(stages,i,step)`, `moveInColumn(stages,i,±1)`, `splitToNewStep(stages,i)`, `addStageToStep`, `removeStage`, `normalizeSteps` (nén bước trống ⇒ liên tục 0,1,2…, sắp mảng không giảm theo `step`, **remap** `backTo`, bỏ đích không còn hợp lệ). Trả `{ stages } | { error: key }` (key i18n lỗi inline). Canvas và panel và StepList cùng gọi | PB2-R01/R02/R16; test không cần DOM |
| FB7 | **Chọn mặc định stage 1** khi mở (panel hiện ngay `Giai đoạn 1: …`) ⇒ test khoá E-P15b/E-PB08/E-PB09 ít phải sửa (chúng mở `region "Giai đoạn 1: …"` ngay sau khi vào trang). Accordion bị thay: panel chỉ hiện **một** stage được chọn; chọn qua click/Enter nút node hoặc dòng StepList. Đổi bước ⇒ `n` trong nhãn ARIA = chỉ số mảng + 1 (mảng luôn sắp theo bước) | CR-063 (17) |
| FB8 | **Q8 chốt = dùng `Alt+←/→/↑/↓`** trên node/dòng đang focus (`preventDefault`), nhưng **không là đường duy nhất**: panel có nút "Chuyển sang bước trước" / "Chuyển sang bước sau" / "Tách sang bước riêng" / "Lên" / "Xuống". Lý do xung đột đã biết: `Alt+←` = Back của Chrome/Edge/Firefox trên Windows (chặn được bằng `preventDefault` khi focus trong node), screen reader có thể chiếm tổ hợp Alt ⇒ nút thay thế là bắt buộc. Kiểm UAT; vướng ⇒ đổi sang `Shift+Alt` (đổi hằng ở một chỗ `lib/canvas-keys.ts`). Thông báo kết quả qua `aria-live="polite"`: "Đã chuyển … sang bước n" | Spec Q8 |
| FB9 | Kéo thả: `onNodeDragStop` ⇒ cột gần nhất theo `x` tâm node (khoảng cách < nửa cột) ⇒ `moveToStep`; thả ngoài cùng bên phải (> cột cuối + nửa cột) ⇒ bước mới. Cột đầy (3) ⇒ **không** đổi, node trượt về chỗ cũ (`aria-disabled` + lỗi inline cạnh node và `role="alert"` ở thanh trên). Trong lúc kéo: cột đầy hiện viền `destructive` + biểu tượng khoá (không chỉ màu). `nodesConnectable=false` (không nối tay), `edgesFocusable=false`, `elementsSelectable` bật; `nodesDraggable = !readOnly` | PB2-R16 |
| FB10 | **Q4 chốt:** UI không seed/mẫu song song; muốn song song thì kéo thả/nút. **Q5 chốt:** dùng mockup làm nguồn, đề xuất artboard A1–A6 để vẽ **sau** (không chặn). **Q7 chốt:** mỗi stage song song một thẻ duyệt, nhóm dưới tiêu đề "Bước n" (`group`) | Spec §9 |
| FB11 | Không thêm thư viện nào ngoài `@xyflow/react` (admin) — chat-web: StageStrip/Timeline CSS thuần (ADR-0013 #5). Icon dùng `lucide-react` sẵn có | FD10 |

## 1. Admin — Canvas `/processes/:id` (A1/A2 · ADM-FR-71)
**Bố cục (≥ 1024 px):** `PageHeader` (tên, badge trạng thái, `Lưu`, ConflictDialog sẵn có) → thẻ "Thông tin"/"Đầu vào"/"Nguồn" như cũ (không đổi) → thẻ **Giai đoạn** gồm: thanh công cụ (nút `Thêm giai đoạn`, `Thêm bước`, nhóm zoom `＋ － Vừa khung` của xyflow `Controls`, nút chuyển `Canvas | Danh sách`) → vùng canvas (cao 520 px, `application` "Canvas quy trình") + **panel bên phải 420 px** (`complementary` "Chi tiết giai đoạn", cuộn riêng) chứa `StageForm`. Dưới 1024 px: panel là `Sheet` (shadcn) trượt từ phải; dưới 768 px mặc định Danh sách. Thẻ "Giới hạn" giữ.

**Thành phần (≤ 200 dòng/file):**
| File (`features/processes/components/…`) | Việc |
|---|---|
| `canvas/ProcessCanvas.tsx` (lazy default export) | `ReactFlow` + `Background` + `Controls`; nhận `nodes/edges` đã dẫn xuất, `onNodeClick`, `onNodeDragStop`, `readOnly`; `fitView` lúc đầu và khi số bước đổi |
| `canvas/StageNode.tsx` (memo) | Nút `button` "Giai đoạn n: <tên>": tên (1 dòng, cắt + `title`), executor (icon agent/team + tên), biểu tượng gate (khiên = duyệt, tia = tự động), huy hiệu "Hành động thật", huy hiệu `↩ bước X` nếu có `backTo`, viền `destructive` + `role` lỗi nếu stage lỗi validate |
| `canvas/StepHeaderNode.tsx`, `JoinNode.tsx` | Tiêu đề cột "Bước n" + nút `＋ Thêm giai đoạn vào bước n` (`aria-disabled` khi đủ 3); join: "Chờ đủ n/n" (`aria-hidden`, trang trí) |
| `canvas/BackEdge.tsx` | Cạnh quay lại tuỳ biến (đường cong phía dưới hàng, nét đứt, nhãn "Quay lại") |
| `lib/canvas-layout.ts` · `lib/step-ops.ts` · `lib/canvas-keys.ts` | Thuần (FB4/6/8) + `.test.ts` |
| `canvas/StepList.tsx` | FB3 |
| `canvas/CanvasToolbar.tsx` | Thêm giai đoạn/bước, chuyển chế độ |
| `editor/StageForm.tsx` → tách (**TECH-DEBT #136**) | `StageGeneral.tsx` (tên/mã/executor/hướng dẫn), `StageActions.tsx` (Lên/Xuống/Chuyển bước/Tách/Xoá), `StageStepFields.tsx` (**mới**: "Chạy ở bước" + "Nếu bị trượt"); `StageForm.tsx` còn là bộ khung ≤ 60 dòng ghép + giữ `StageOutput`, `StageSourcesField`, `StageMustKnow`, `AfterFields`, `AnswererFields` (AfterFields/AnswererFields chuyển file `StageGate.tsx`/`StageAnswerer.tsx`). **Giữ nguyên** `section aria-label="Giai đoạn {{n}}: {{name}}"` và mọi nhãn trường hiện có |
| `editor/StagesCard.tsx` | Thay Accordion bằng `StageWorkbench` (canvas/StepList + panel); giữ `LimitsCard`. Bỏ `d.open/setOpen`, thêm `d.selected` (uid) vào `use-draft` |

**Panel — hai phần mới (A1):**
- **Chạy ở bước** (`spinbutton`, 0…9, nhãn "Chạy ở bước"): nhập số ⇒ `moveToStep`; kèm chữ phụ "Cùng bước = chạy song song (tối đa 3)". Số ngoài dải/ khoảng trống ⇒ nén tự động; bước đầy ⇒ lỗi inline, giá trị trả về cũ.
- **Nếu bị trượt** (chỉ hiện khi `after = review`): nhóm `checkbox` "Cho phép quay lại bước" × mỗi bước **nhỏ hơn** bước của stage (Q6: không song song cùng bước), mỗi hộp nhãn `Bước n — <tên các giai đoạn>`; mặc định không chọn (= chỉ làm lại stage này); chữ phụ "Người duyệt chọn quay lại khi chấm Chưa đạt. Tối đa 3 lần quay lại cho mỗi lần chạy." Bước 0 ⇒ khối ẩn kèm câu "Bước đầu không có bước nào phía trước". Đổi `after` sang `auto` ⇒ xoá `backTo` (kèm toast thông tin? không: im lặng, mô tả nằm trong chữ phụ).
- **Hành động thật** khóa/mở theo `canRealAction` mới: **mọi** stage bước liền trước có `after=review` và bước ≥ 1 (PB2-R03). Sửa `lib/def-form.ts` `canRealAction(all,index)` theo bước + validate đích quay lại.

**Trạng thái:**
| Trạng thái | Hiển thị |
|---|---|
| Đang tải def | skeleton khung canvas + `aria-busy`; chunk `canvas` đang nạp ⇒ `StepList` (không nhấp nháy rỗng) |
| Chunk nạp lỗi | `StepList` + `Alert` "Không tải được canvas. Đang dùng dạng danh sách." + `Thử lại` |
| Rỗng (0 stage, def mới) | canvas một cột trống: "Chưa có giai đoạn. Thêm giai đoạn đầu tiên." + nút `Thêm giai đoạn` (focus vào nút) |
| Lỗi tải def | `ErrorState` sẵn có (retry) |
| Chỉ xem (mẫu `platform` / không quyền sửa) | `nodesDraggable=false`, ẩn nút thêm/xoá/＋, panel `readOnly` (trường disabled như hiện tại), dải thông tin sẵn có "Đây là quy trình mẫu, chỉ xem. Chép mẫu để chỉnh sửa."; nút `Chép mẫu` giữ |
| Không có quyền | `ProcessRouteGate`/`ForbiddenState` hiện có |
| Xung đột 409 | `ConflictDialog` hiện có "Có người vừa lưu…" + "Tải bản mới" (giữ nguyên e2e) |
| Lỗi validate | inline tại stage: viền node + dòng lỗi trong panel (`aria-describedby`) + thanh tóm tắt `role="alert"` ở thẻ; `Lưu` vẫn bấm được, server 422 map theo mã (`STEP_TOO_WIDE`…) ra cùng câu tĩnh (FS4: không dùng `message` server) |

**Validate phía client** (khớp contract/spec; câu chữ VI/EN: i18n §2):
| Trường / lỗi | Luật | Key lỗi |
|---|---|---|
| `step` | số nguyên 0…9, liên tục (tự nén), mảng không giảm | `process.admin.canvas.err.step` |
| Bước đầy | ≤ 3 stage/bước | `…err.stepFull` |
| Tổng stage | ≤ `PROCESS_STAGES_MAX` (10) (nút Thêm bị khoá + câu chữ) | `…err.stagesMax` |
| `real_action` | mọi stage bước trước = review; bước 0 ⇒ không | `…err.realStep` (thay `stage.realLocked`) |
| `backTo` | mỗi đích < bước stage và là bước tồn tại; chỉ khi `after=review` | `…err.backTarget` |
| Cũ | name/key/executor/… như P-a/P-b, không đổi | key cũ |

## 2. Admin — tương tác bàn phím & a11y
| Tác vụ | Cách |
|---|---|
| Vào canvas | `Tab` vào vùng `application` → `Tab` đi tuần tự các nút stage theo thứ tự mảng (`tabIndex` thủ công, không dùng roving của xyflow cho nút) ; `Enter`/`Space` chọn + mở panel và đưa focus vào ô "Tên giai đoạn" |
| Đổi bước / thứ tự | `Alt+←/→` bước trước/sau (cột đầy ⇒ lỗi + không đổi), `Alt+↑/↓` thứ tự trong cột; hoặc nút trong panel (FB8); sau khi đổi, focus **ở lại** stage (giữ `uid`) |
| Xoá | `Delete` khi focus node (khi không readOnly) ⇒ `AlertDialog` "Xoá giai đoạn …?" (giữ nút `Xoá giai đoạn` ở panel như cũ) |
| Thông báo | `aria-live="polite"` vùng ẩn: "Giai đoạn n chuyển sang bước m", "Bước m đã đủ 3 giai đoạn" |
| Lối tắt | `?` hiện tooltip "Phím tắt" (danh sách 5 dòng); không phím toàn cục |
| Tương phản | node/cạnh dùng token (`border`, `primary`, `warning`, `destructive`); cạnh quay lại đứt **và** có nhãn chữ (không chỉ màu); trạng thái lỗi/khoá = icon + chữ |
| Chuyển động | `prefers-reduced-motion` ⇒ tắt animation cạnh/`fitView` duration 0 |

## 3. Chat-web — StageStrip theo bước (A3 · CHAT-AC-59)
`shared/components/StageStrip.tsx` (CSS thuần, memo). Prop mới: `StageStripItem = { idx, name, status, step?, round? }`; thiếu `step` ⇒ `step = idx` (def/run cũ ⇒ **hiển thị y như hiện nay**, AC-PB2-01).
- Gom theo `step` (hàm thuần `groupBySteps` trong `shared/lib/steps.ts`, có test). Cấu trúc: `<ol aria-label="Tiến độ quy trình">` → mỗi **bước** là `<li>`; bước nhiều stage chứa `<ul aria-label="Bước n — chạy song song">` xếp dọc (tối đa 3), viền trái nhẹ `border-border` để nhận ra nhóm; bước 1 stage hiển thị như chấm + tên cũ.
- Nhãn `Bước n` chỉ hiện khi run **có ít nhất một bước ≥ 2 stage** hoặc có `round > 1` (giữ giao diện cũ cho quy trình tuần tự). Chấm màu theo `DOT` hiện có; thêm chữ ẩn `sr-only` trạng thái (đã có).
- **×lần** (PB2-R13): `round > 1` ⇒ huy hiệu nhỏ `×2` cạnh **tên bước/stage** (`title`/`sr-only`: "Đã làm lại lần 2 do quay lại bước"). `attempt` không hiện.
- **Vệt quay lại:** nếu `back_events` có ⇒ dưới strip một dòng nhỏ `↩ Quay lại bước 1 (lần 2)` (`text-caption text-warning-foreground`); nếu `back_rounds ≥ 3` thêm "Đã quay lại tối đa 3 lần" (chỉ chữ, khi hết lượt).
- Dùng ở: `ProcessBlock`/`ProcessFlowContent` (thread), `ProgressTab` (trang Run), `block-view.ts` ánh xạ `view.stages` ⇒ items.

## 4. Chat-web — thẻ duyệt "Quay lại bước X" (A4 · CHAT-AC-60)
`run-block/components/ReviewTaskCard.tsx` (nay ~110+ dòng): tách `ReviewFailPanel.tsx` mới.
- Không có tuỳ chọn quay lại (stage `backTo=[]`, hoặc `back_rounds ≥ 3`) ⇒ **hành vi cũ nguyên vẹn** (thread: composer Góp ý; ngoài thread: ô inline).
- Có tuỳ chọn ⇒ bấm `Chưa đạt` luôn mở `ReviewFailPanel` inline (kể cả trong thread; composer giữ nguyên): `radiogroup` "Chưa đạt thì…" gồm `radio` "Làm lại giai đoạn này" (mặc định) và mỗi đích `radio` "Quay lại bước X" (mô tả `aria-describedby`: "Chạy lại: <tên các giai đoạn bước X…>"), ô `textbox` "Góp ý" **bắt buộc** (HUB-FR-107; câu lỗi cũ `process.run.review.feedbackRequired`), dòng cảnh báo khi chọn quay lại: "Còn {{n}} lần quay lại. Các bước từ {{x}} trở đi sẽ chạy lại; kết quả cũ vẫn xem được." (`role="note"`); nút `Gửi chưa đạt` (loading), `Huỷ`.
- Gửi: `POST /review-tasks/:id/decision {result:"fail", feedback, back_to_step?}`. Lỗi: 422 `BACK_TARGET_INVALID` ⇒ câu tĩnh + làm tươi view; **409 `REVIEW_TASK_CLOSED`** (PB2-R09, người khác quay lại trước) ⇒ toast thông tin "Giai đoạn này vừa được xử lý ở bước khác. Đã cập nhật." + invalidate (đóng thẻ); 409 khác như cũ.
- Thành công quay lại ⇒ toast "Đã quay lại bước {{step}}. Các giai đoạn sẽ chạy lại với góp ý của bạn." + invalidate view / "Chờ tôi kiểm" như `use-review-actions`.
- **Q7:** nhiều stage song song cùng chờ duyệt ⇒ `TaskPanel`/danh sách thẻ nhóm dưới tiêu đề `group` "Bước n" (chỉ khi ≥ 2 thẻ cùng bước); mỗi thẻ độc lập.

## 5. Chat-web — trang Run theo bước + lịch sử quay lại (A5)
`run-page/components/ProgressTab.tsx` (105 dòng) + `StageOutputs.tsx` (44) + `RunHeader`.
| Khối | Nội dung |
|---|---|
| Tiến độ | nhóm `group` "Bước n" (+`×{{n}} lần` khi `round>1`); mỗi stage một dòng: trạng thái, executor, người duyệt, thời gian, `attempt` ("lần làm n") |
| **Timeline quay lại** (`BackTimeline.tsx`, mới; ẩn khi `back_events` rỗng) | danh sách `ol` theo thời gian: "Vòng {{round}} · {{by}} chấm Chưa đạt ở giai đoạn {{stage}} → quay lại bước {{to}} · {{time}}" + trích góp ý (cắt 2 dòng, mở rộng `Xem đầy đủ`). Người xem ngoài phòng (access `task`) ⇒ khối không có (AC-PB2-11) |
| **Kết quả nhiều phiên bản** (`StageOutputs`) | mỗi stage có > 1 phiên bản ⇒ `Tabs` nhỏ "Bản {{n}}" (bản mới nhất mặc định, nhãn "mới nhất"; bản cũ "trước khi quay lại"); 1 phiên bản ⇒ như cũ |
| Header | `RunStatusBadge`; lý do `back_limit` qua `ReasonHint` |
| **Thẻ `back_limit` (A6)** | dùng lại thẻ "Cần người quyết" + 3 lựa chọn sẵn (`extend` thêm lượt = +1 vòng · `use_current` dùng bản hiện có · `cancel`); chỉ thêm câu `process.common.back_limit` ("Đã quay lại tối đa {{max}} lần mà chưa đạt.") và ánh xạ ở `decision-reason.ts` (`params: {max: 3}` từ hằng contract) |

## 6. Hiệu năng
| Mục | Biện pháp |
|---|---|
| Bundle | Xem FB2: canvas lazy ≈ 65 KB gz, ngân sách chunk `canvas*` 80 KB trong `check-bundle.ts` (+ test `check-bundle.test.ts` thêm ca); initial không đổi (kiểm bằng `check:bundle` trước/sau). Chat-web: không thư viện mới; StageStrip +≈ 1 KB |
| Render | `nodeTypes`/`edgeTypes` hằng ngoài component; `StageNode` `memo` + so sánh theo `{id, data}`; nodes/edges `useMemo` theo `stages` đã **chuẩn hoá** (reference ổn định khi gõ ở panel: tách `data` của node chỉ chứa tên/executor/gate/backTo/lỗi — gõ `instruction` không dựng lại canvas); `onlyRenderVisibleElements` không cần (≤ 10 node); `proOptions.hideAttribution` **không** bật (giữ ghi công theo MIT/khuyến nghị) |
| Bảng > 200 dòng | không có |
| Đo | 10 node kéo thả ≥ 50 fps — chỉ đo (memory "Perf later") |

## 7. Role + nhãn e2e (qc dùng; BUILD phải giữ đúng)
| Màn | Role · tên |
|---|---|
| Canvas | `application` "Canvas quy trình"; nút stage `button` "Giai đoạn n: <tên>" (nội dung bên trong có thêm executor/gate — QC dùng `name` regex hoặc `{name:/^Giai đoạn 2: /}`); tiêu đề cột `heading`/nút `button` "Thêm giai đoạn vào bước n"; thanh công cụ `button` "Thêm giai đoạn", "Thêm bước", `radio`/`tab` "Canvas"/"Danh sách" (`tablist` "Chế độ xem") |
| Panel | `complementary` "Chi tiết giai đoạn" chứa `region` "Giai đoạn n: <tên>" (**nhãn cũ**); trong đó `spinbutton` "Chạy ở bước"; `group` "Nếu bị trượt" với `checkbox` "Quay lại bước n" ; nút "Chuyển sang bước trước", "Chuyển sang bước sau", "Tách sang bước riêng", "Lên", "Xuống", "Xoá giai đoạn" |
| Lỗi | `alert` chứa "Bước n đã đủ 3 giai đoạn song song." |
| Bàn phím | focus nút stage + `Alt+ArrowRight` ⇒ bước đổi; `status` (live) "Giai đoạn n chuyển sang bước m" |
| Chat strip | `list` "Tiến độ quy trình" → `listitem` mỗi bước; con `list` "Bước n — chạy song song"; chữ `×2` |
| Thẻ duyệt | `button` "Chưa đạt" → `radiogroup` "Chưa đạt thì…", `radio` "Làm lại giai đoạn này", `radio` "Quay lại bước 1", `textbox` "Góp ý", `button` "Gửi chưa đạt" |
| Run page | `group` "Bước n"; `list` "Lịch sử quay lại" (mỗi vòng `listitem`); `tab` "Bản 1"/"Bản 2" |
| Thẻ quyết | text "Đã quay lại tối đa 3 lần mà chưa đạt." + 3 nút sẵn có |

**Test khoá cần qc cập nhật (T2):** **E-P15b** (`e2e/P-a/pf4/admin-editor.pa.ts`): `region "Giai đoạn 1: …"` nay nằm trong `complementary` và stage 1 được chọn sẵn (FB7) — hầu như giữ nguyên; thêm bước vào fixture không bắt buộc (mặc định mỗi stage một bước). **E-PB08/E-PB09** (`e2e/P-b/admin/editor.pb.ts`): `stage1(p,name)` vẫn đúng; nếu test chọn stage khác stage 1 thì phải bấm nút node `button "Giai đoạn n: …"` trước (accordion không còn). Thêm ca mới (e2e/P-b2/admin): kéo/`Alt+→` đổi bước, bước đầy báo lỗi, đặt "Nếu bị trượt", Lưu ⇒ tải lại còn nguyên, chế độ Danh sách, chỉ xem (mẫu); e2e/P-b2/chat: strip theo bước, `×2`, thẻ duyệt radio, timeline.

## 8. Đề xuất artboard (điều phối vẽ sau — **không chặn BUILD**, Q5)
Nguồn: mockup Part B (B1, B2) + token design system. A1 canvas (cột bước + header "＋", node stage 240×88 [tên/executor/gate/huy hiệu], join "Chờ đủ n/n", cạnh quay lại đứt màu `warning`, panel 420 px 3 phần, toolbar); A2 (skeleton/rỗng/lỗi/chỉ xem, Danh sách); A3 StageStrip theo bước (nhóm dọc, ×2, vệt quay lại); A4 thẻ duyệt radio + cảnh báo "còn n lần"; A5 Run (nhóm bước, timeline, Tabs phiên bản); A6 thẻ `back_limit`. Lệch giữa mockup và plan này thì **mockup thắng về hình dáng**, plan thắng về nhãn/ARIA.

## 9. Cần từ backend (đề xuất; không tự đổi contract)
| # | Cần | Lý do |
|---|---|---|
| B1 | Export hằng ở `@ai/contracts/hub-admin`: `PROCESS_STEP_MAX=9` (số bước tối đa − 1), `PROCESS_STEP_STAGES_MAX=3`, `PROCESS_BACK_ROUNDS_MAX=3` | FE dùng chung với validate, tránh trùng số |
| B2 | `ProcessRunFullView.stages[]` thêm `back_to_steps: int[]` (bản trong snapshot) và `process_run` thêm `back_rounds`, `current_step`; ProcessRunTaskView.stages thêm `step`,`round` | Thẻ duyệt biết đích quay lại; strip theo bước (PB2-R13); người ngoài phòng vẫn vẽ được strip |
| B3 | `StageView` thêm `outputs: { version, round, output: OutputRefSchema }[]` (cũ → mới; `output` hiện có = bản mới nhất) | Tab "Bản n" (PB2-R07 "giữ làm phiên bản") |
| B4 | `HistoryItem.kind` thêm `"back"` (hoặc `back_events` như spec §3) với `to_step`, `round`, `feedback`, `actor`, `stage_idx` | Timeline quay lại |
| B5 | `DecisionOptionSchema`/`reason` có `back_limit`; option `extend` (+1 vòng) rõ nghĩa cho `back_limit` | Thẻ A6 |
| B6 | Lỗi 422 mang `details.issues[].path` dạng `stages.<i>.step` / `stages.<i>.after.back_to_steps` để map inline | FS4 |

## 10. Rủi ro / bẫy
| # | Rủi ro | Cách xử |
|---|---|---|
| R1 | xyflow cần kích thước vùng cố định (cao 0 ⇒ trống) | container `h-[520px]`; test render smoke trong e2e |
| R2 | `React.lazy` + autoCodeSplitting của TanStack Router: chunk đặt tên | dùng `lazy(() => import(/* webpackChunkName: "canvas" */ …))`; kiểm tên chunk trong `dist/static/js/async` ở T9 trước khi chốt ngân sách |
| R3 | Focus nhảy khi dựng lại node sau đổi bước | `key` = `uid` ổn định; sau thao tác `requestAnimationFrame` focus lại nút theo `uid` |
| R4 | `Alt+←` làm trình duyệt lùi trang | FB8 (preventDefault + nút thay thế) |
| R5 | JSDOM không chạy xyflow tốt | unit chỉ test `canvas-layout`/`step-ops`/`groupBySteps`; canvas kiểm bằng e2e |
