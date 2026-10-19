# Review GX2 (2026-10-19) · nhánh platform/gd0

Phạm vi: `59e80679` (test), `4d39f30d` (sản phẩm), `120dfc54` (docs). Một reviewer, chỉ đọc.

## Phán quyết: APPROVED (0 Critical, 0 High, 0 Medium, 2 Low, 3 Info)

## Đã kiểm

**Test khoá (đúng quyết định 2026-10-19)**
- R48: `slice(0,15)` `toEqual` đúng 15 lý do H2c theo thứ tự (tiền tố), cho phép lý do thêm sau; không nới thêm.
- R49: `OWN_SCHEMAS` ánh xạ `SourceApplyJob`/`SourceResolveJob` sang `SourceApplyJobSchema`/`SourceResolveJobSchema`; vòng lặp vẫn `expect(schema).toBeDefined()` và kiểm đúng chiều valid/invalid cho mọi fixture, không bỏ qua.
- R-K01: chỉ thêm `branch` cuối danh sách `ROOM_PROCESS_KINDS` (toEqual đầy đủ).
- e2e: 4 spec + helper `openWorkflowProcessFromNav` theo DLC-R15 (nhóm Workflows → Workflow Process; nút "+ Thêm workflow" → menuitem "Workflow Dify"; `WorkflowsPage`, `nav.ts`, `steps.tsx` khớp). Vẫn khẳng định URL, bảng, chip, 201, ForbiddenState; ca tenant_admin còn chặt hơn (thêm kiểm nhóm và Workflow Steps/Process vắng). Không skip/sleep/retry/timeout nào thêm.
- `tests/.lock`: đúng 7 dòng đổi (4 e2e spec, `helpers.ts`, `contracts-h2c`, `contracts-pa`); `test:lock:verify` OK (980 file). TZ-R02 không bị chạm.
- Chạy: contracts-h2c, contracts-pa, test-all.discover, `apps/chat-web/src/features/run`: 49 pass, 0 fail.

**Sản phẩm**
- `quotaOver` trong run-store: đặt theo `run.started` mới nhất (`quota` bắt buộc trong contract nên không có trạng thái cũ rơi rớt); `isNewEvent` + guard terminal chặn phát lại; `remove` không đụng, `clear` (qua `dropAll` khi `session cleared/expired`) đặt lại và thông báo ⇒ không rò giữa phiên đăng nhập. Unit test phủ remove/cập nhật/clear.
- ForwardDialog: khi không có lỗi hoặc lỗi khác dòng hướng dẫn ⇒ `DialogDescription` vẫn hiện (`helpIsError` false, aria-describedby giữ mặc định); chỉ khi lỗi trùng nguyên văn mới bỏ mô tả (một lần, còn `alert`).
- `#0f1020`: chỉ `apps/chat-web/src/styles/globals.css` `.dark --background`; admin-web/studio-web giữ `#0e131b`, không file khác của chat-web hard-code màu cũ.
- Không có shortcut (skip, sleep, retry, nới timeout) trong diff; `gate.md` ghi 3/23 đỏ chập chờn bằng số thật, không retry.

## Phát hiện

- **L1 (Low)** `run-store.ts:55`: `quotaOver` nay nhận `run.started` của mọi run (origin `flow`, run gắn lại), trước đây chỉ run `main` gần nhất. Quota là cấp phiên/tenant nên hợp lý, nhưng là đổi hành vi chưa có test; nên thêm một ca cho origin `flow` hoặc ghi quyết định vào tasks.
- **L2 (Low)** Luật 4b: sửa ForwardDialog (CHAT-AC-57) và nhắc quota qua composer chưa có test cấp component; chỉ có unit store và e2e hiện có (xanh trong lượt gate). Chấp nhận được ở làn nhanh, nên bổ sung một test nhỏ ForwardDialog "lỗi = help ⇒ một phần tử".
- **I1 (Info)** `sessionStorage "chat:quota-dismissed"` không bị xoá khi đăng xuất (có từ trước): người dùng khác trong cùng tab thừa hưởng trạng thái ẩn.
- **I2 (Info)** `test-all.discover.test.ts` (không khoá, ngoài danh sách quyết định) giờ cứng 18 cấu hình: thêm cấu hình e2e mới sẽ làm đỏ ca này (chủ ý, đã ghi chú trong file).
- **I3 (Info)** Nền tối `#0f1020` nhưng `--card` v.v. vẫn của "Midnight" (`#161e2a`) khi tokens-map CR-049 là `#171833`; ngoài phạm vi quyết định, cân nhắc ở nợ giao diện. `gate.md` ghi "7 file đổi + helpers" trong khi tổng là 7 dòng khoá gồm cả helpers.
