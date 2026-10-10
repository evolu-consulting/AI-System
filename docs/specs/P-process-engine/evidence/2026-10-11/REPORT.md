# UAT P-a (Process Engine) — 2026-10-11

Người chạy: `qc-uat` (trình duyệt thật, dev stack, `HUB_PROCESS_ENGINE=on`, agent `fake-cli`). Ảnh: `shots/` (43 ảnh); script: `scripts/`; JSON: `chat-result.json`, `admin-result.json`. Báo cáo do điều phối ghi lại từ output của qc-uat (công cụ ghi file của agent bị từ chối).

## Stack
hub-api `:4000` (engine on, `HUB_DEV_CONTRACT_FIXTURE=1`, CORS +`:3000`), admin-api `:3001`, runtime container `fake-cli` (`runtime.ready`), chat-web `:3100`, admin-web `:3000`. Tenant `acme`: `lan` (khởi chạy), `hoa` (trong phòng, nhóm Kế toán), `minh` (ngoài phòng, Kế toán — tạo mới), `tadmin` (tenant_admin), `admin`/platform. Mật khẩu minh/tadmin = `Uat-pass-12345`.

## Kết quả theo kịch bản
| # | Kịch bản | Kết quả | Ảnh |
|---|---|---|---|
| 1a | `!hoa-don …` trong phòng ⇒ khối + thread, hoa cũng thấy | PASS | `02-*` |
| 1b | Nút "Quy trình" ⇒ menu mẫu ⇒ chèn `!hoa-don ` ⇒ gửi | PASS | `03-*` |
| 1c | Hỏi AI `!key` | PASS (có lỗi D2) | `04-*`, `13b-*` |
| 1d | Chạm trần 5 lượt | PASS (thông báo VI rõ) | `11-*` |
| 2 | Giai đoạn agent + thẻ kiểm Đạt/Chưa đạt | BLOCKED (B1) | — |
| 3 | Hỏi ⇒ trả lời + forward | BLOCKED (B1) | — |
| 4 | Ngoài phòng / hộp thư / starter-left | PASS một phần | `07-*`,`08-*`,`09-*` |
| 5 | Tab Token (120 = Σ usage_logs) | PASS | `10-*` |
| 6 | Admin "Quy trình" | PASS một phần | `22-*`,`25-*`,`35-*` |

Nhánh quyết định (thuộc S2): "Thêm 1 lần làm lại" + "Huỷ lượt chạy" → PASS (`06-*`).
S4 đạt: "Chờ tôi kiểm" + DM "Quy trình" hiện thẻ quyết định (`07`); `minh` ngoài phòng mở `/runs/:id` ⇒ "Không tìm thấy" (`08`); starter-left (U5): `lan` rời phòng ⇒ banner "Bạn không còn ở phòng này…" (`09`). Chưa kiểm được bản xem giới hạn của người kiểm ngoài phòng (B1).
S6 đạt: tenant_admin dùng được nav/danh sách/Mẫu/Chép mẫu/editor/Chạy/Lượt chạy/Token; platform_admin dùng được bộ chọn công ty + Mẫu + nút Chạy bị vô hiệu đúng spec.

## Blocker cài đặt
- **B1 (dev-tooling):** `fake-cli` (`apps/agent-runtime/src/agent_runtime/providers/fake/provider.py:183`) chỉ echo 1 dòng → không có heading `## <mục>` → `checkTemplate` luôn `template_invalid` → mọi run dừng `needs_decision` sau 4 lần làm lại. Chặn S2/S3 và phần agent của S4 trong trình duyệt dev. (e2e đã phủ các luồng này bằng mock runtime, 26/26.) Đề xuất: thêm chỉ thị `#fake:sections=…` / `#fake:ask=…` cho fake provider, hoặc runtime TS như `e2e/P-a/_pa-runtime.ts`.
- **B2 (seed dev):** `hoa-don` acme bị tắt, thiếu nhóm `ke-toan`, thiếu grant agent, thiếu workflow `ghi-so` trong `admin.workflows`; CORS cũ chỉ `:3100`. qc-uat tự dựng (nhóm Kế toán, user minh, grant 9 agent, bật hoa-don + chọn nhóm kiểm) qua API/UI (`setup.mjs`, `setup2.mjs`). Cần seed dev đầy đủ để người dùng test ngay.

## Lỗi app (đã kiểm chứng)
| ID | Mức | Mô tả | Chứng cứ |
|---|---|---|---|
| D1 | Cao (FE) | Khối quy trình trong phòng không hiện trạng thái/giai đoạn khi mới mở phòng (thanh xám rỗng, huy hiệu trống); chỉ hiện sau khi bấm "Trả lời tiếp" mở thread. Gặp ở `needs_decision` và `cancelled`, không lỗi HTTP. | `12-H-block-before/after-thread`, `05-FAIL-L`, `blk-state.mjs` |
| D2 | Cao (FE) | Hỏi AI: nút Gửi gọi `POST /process-runs` → `/runs/:id` (đúng); phím Enter gọi `POST /conversations`+`/messages`, Hub vẫn tạo run nhưng UI đứng ở `/c/new`, giữ chữ (cả sau reload) → không phản hồi, dễ gửi trùng. | `04-L-askai`, `13b-L-askai-enter-*`, `askai2.mjs` |
| D4 | Cao (BE) | platform_admin chọn acme ⇒ tab "Lượt chạy" luôn rỗng dù "Lượt đang chạy"=3. `GET /process-runs?scope=tenant&process_key=hoa-don&tenant_id=<acme>` bằng token platform_admin ⇒ `{items:[]}`; cùng truy vấn bằng tenant_admin ⇒ đủ. (RV1 đã sửa view/decide `?tenant_id` nhưng KHÔNG sửa endpoint LIST.) | `35-P-runs-tab-5s`, `A7-FAIL-P`, `p-runs.mjs` |
| D3 | Thường (FE) | Breadcrumb `/processes/new` lộ khoá i18n thô `process.admin.editor.title.new`. | `23-T-editor-empty-save` |
| D5 | Thường (BE+FE) | "Làm bởi" hiện UUID agent thay vì tên (bảng giai đoạn trang lượt chạy admin + thẻ "Giai đoạn 1" trong thread). (B5 cố ý dùng id làm name — UAT cho thấy cần tên.) | `25-T-run-page`, `12-H-block-after-thread` |
| D6 | Thường (FE) | Thẻ giai đoạn trong thread ghi "0 bước · 0 token" (tab Token ghi 120); thread + "Chờ tôi kiểm" lộ mã thô `template_invalid`; thẻ "Quy trình dừng ở giai đoạn…" lặp 2 lần; mục "Chờ tôi kiểm" cùng nhãn khó phân biệt run. | `05-FAIL-L`, `07-L-inbox` |
| D7 | Thấp (FE) | "Thử lại sau 29 giây" khi chạm trần gây hiểu nhầm (run `needs_decision` giữ chỗ tới khi quyết định/huỷ). | `11-L-limit-429` |
| D8 | Thấp (FE) | Sau Chép mẫu vẫn ở tab "Mẫu"; ô "Group được chạy" lặp nhãn; tenant_admin bấm Chạy khi chưa có grant ⇒ run dừng "Người bắt đầu không còn quyền…" mà hộp Chạy không cảnh báo trước. | `22-T-copy`, `25-T-run-page` |

## Chưa kiểm (do B1)
Thẻ kiểm Đạt/Chưa đạt end-to-end qua agent, làm lại chọn lọc theo góp ý, AskCard, forward, "Chờ tôi kiểm" có việc kiểm thật, quy trình `sdlc` nhiều giai đoạn. (Đều đã phủ ở e2e với mock runtime.)

## Dọn sau
Còn chạy: hub-api, container `ai-hub-dev-runtime`, dev server `:3100`/`:3000`. Dừng khi xong phiên UAT.
