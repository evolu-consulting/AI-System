# ADR-0013 · Canvas quy trình admin-web: `@xyflow/react`

Trạng thái: **Accepted** — người dùng duyệt Gate P-b2 ngày 2026-10-12 (xem `specs/P-b2-canvas/spec-decisions.md`, G-1) · Ngày: 2026-10-12 · CR-063 · Kế thừa: ADR-0001, ADR-0004/0005 (nguyên tắc ít thư viện, biểu đồ Admin không recharts)

## Bối cảnh
CR-063: `/processes` ở admin-web đổi từ accordion stage sang canvas kéo thả theo **bước** (stage song song cùng cột, mũi tên quay lại). Cần kéo thả, pan/zoom, cạnh nối; tự viết toàn bộ tốn thời gian và dễ lỗi trợ năng.

## Lựa chọn
| # | Phương án | Nhận xét |
|---|---|---|
| A | Giữ accordion + nút lên/xuống | Không hiện được song song/quay lại rõ |
| B | Tự viết SVG + pointer events | Nhiều việc kéo thả/zoom/a11y |
| C | **`@xyflow/react`** (React Flow) | Chọn: đủ tính năng; kiểm bundle |

## Quyết định (đã duyệt — Gate P-b2, 2026-10-12)
1. Dùng **`@xyflow/react` 12.11.6** (ghim đúng, không `^`) **chỉ trong `apps/admin-web`**; không dùng ở chat-web/studio-web. Nguồn: npm `@xyflow/react`; đăng 2026-09-01 (> 6 tuần tuổi lúc chọn 2026-10-12; bản 12.12.0 đăng 2026-09-24 chưa đủ 4 tuần nên bỏ qua; `13.0.0-next.0` là bản thử). License **MIT** (kiểm `package.json` của `@xyflow/react` và `@xyflow/system`). Phụ thuộc: `@xyflow/system` 0.0.82 (MIT), `classcat`, `zustand@^4`; peer React ≥ 17 ⇒ hợp React 18.3.1; Rsbuild/Rspack bundle bình thường (ESM). ai-sdlc (`D:\AIi-sdlc-rowan\POC\AISDLC\web`) đang chạy cùng bản 12.11.6.
2. **Lazy chunk** `canvas` (`React.lazy` trong `ProcessEditorPage`; không nạp ở `/processes` danh sách, Run, hay trang khác). **Đo thật** (bun build minify, React để external, import `ReactFlow, Background, Controls, Handle, MarkerType, useNodesState`): JS **≈ 54.4 KB gzip**, CSS `base.css` ≈ **2 KB gzip**. Cộng mã canvas của ta ước 8–10 KB ⇒ chunk ≈ **65 KB gzip** > trần chunk chung 50 KB (ADM-NFR-06). ⇒ `scripts/check-bundle.ts` thêm `CANVAS_CHUNK_BUDGET_BYTES = 80 KB` **chỉ cho chunk tên `canvas*`**; mọi chunk khác giữ 50 KB; **bundle tải ban đầu (150 KB JS / 25 KB CSS) không đổi**. Nếu số đo thật ở BUILD > 80 KB ⇒ hạ phạm vi import (bỏ `Controls`/`Background` tự vẽ) trước khi nâng trần.
3. **Layout tự viết theo cột bước**; **không lưu toạ độ** (suy ra từ `step` + thứ tự trong `process_defs`) — không thêm dagre/elk.
4. Form stage giữ trong **panel bên**, cùng nhãn ARIA "Giai đoạn n: …"; stage 1 chọn sẵn khi mở ⇒ ít sửa test khoá E-P15b/E-PB08/E-PB09 (qc cập nhật khi tới mốc).
5. **StageStrip, timeline quay lại ở chat-web vẽ bằng CSS thuần** (không kéo xyflow vào chat).
6. **Đường a11y không phụ thuộc xyflow:** `StepList` (DOM thuần) vừa là fallback khi chunk lỗi/đang tải vừa là chế độ "Danh sách"; mọi thao tác đổi bước làm được bằng nút, `Alt+mũi tên` chỉ là phím tắt.

## Phương án đã cân nhắc (bổ sung)
| Phương án | Vì sao không |
|---|---|
| A. Accordion + nút lên/xuống (giữ) | Không thấy được song song/quay lại (CR-063) |
| B. Tự viết SVG + pointer events | Ước 600–900 dòng (zoom/pan, kéo, hit-test, a11y) và nhiều lỗi biên; tiết kiệm ≈ 55 KB gz nhưng tốn công lớn; cân nhắc lại nếu chunk không đạt ngân sách |
| C. `@xyflow/react` 12.11.6 | **Chọn** |
| D. `reactflow` (v11 cũ) | Gói cũ, tên cũ, không nhận fix mới |
| E. `elkjs`/`dagre` cho layout | Thêm 100+ KB; layout theo cột đơn giản, không cần |
| F. `@dnd-kit` + SVG tự vẽ cạnh | Thêm thư viện kéo thả nhưng vẫn tự làm cạnh/zoom |

## Hệ quả
- Thêm một phụ thuộc runtime cho admin-web (`@xyflow/react` + 2 gói con); bundle chính không đổi nhờ lazy chunk; thêm một ngân sách riêng (80 KB) cho chunk `canvas`.
- Phải test e2e canvas bằng trình duyệt thật (JSDOM không chạy xyflow tốt); layout/step-ops test đơn vị thuần.
- Hiển thị ghi công "React Flow" mặc định giữ nguyên (không bật `hideAttribution`).
- Test e2e hiện có (E-P15b/E-PB08/E-PB09) phải chạy lại sau khi đổi UI; ADR đã Accepted ở Gate.
- Cập nhật khi nâng cấp: đo lại bundle; không nâng lên major (13.x) khi chưa có ADR.
