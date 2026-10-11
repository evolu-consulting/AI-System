# Kịch bản test — sdlc-có-nguồn trên evolu (P-b CR-060)

Mục tiêu: chạy một quy trình **theo đúng workflow sdlc hiện tại** (8 giai đoạn) nhưng trên tenant **evolu**, có **nguồn tham chiếu `local_path` trỏ tới repo `D:\AI\ai-system`**, để kiểm agent đọc repo thật (Read/Grep/Glob), MANIFEST, mục `## Nguồn tham chiếu`, audit, ẩn path, cổng review, team stage.

> ⚠️ **Điều kiện tiên quyết:** phải có bản vá **B1 + B2 + B3** (read-path Claude thật / snapshot non-root / quét repo lớn) — xem `REPORT.md`. Trước khi vá, run Claude thật có nguồn sẽ kẹt `needs_decision`. Điều phối sẽ seed cấu hình dưới đây **sau khi backend-lead xong B1–B3**.

---

## 0. Chuẩn bị (điều phối lo, bạn chỉ cần biết)
- Stack: hub-api :4000 (`HUB_PROCESS_ENGINE=on`), admin-web **:3000**, chat-web **:3100**, Runtime WSL có `claude-sub` đăng nhập (`claude auth status` = logged in).
- Migration 0021 + 0022 đã áp vào DB dev `ai_system`.

## 1. Tài khoản evolu (mật khẩu `1234567890`)
| Vai | User | Dùng để |
|---|---|---|
| platform_admin | `admin` (tenant platform) | Tạo nguồn `local_path` (chỉ platform_admin), cấp agent |
| tenant_admin | `julian.bui` | Kiểm **ẩn path** nguồn local_path |
| Người **bắt đầu** quy trình | `thomas.tran` | Chạy sdlc-evolu từ chat |
| Người **duyệt cổng review** | `vio.ngo` (+ `edgar.nguyen`) | Bấm Đạt/Không đạt ở cổng kiểm người |

## 2. Nguồn (platform_admin tạo tại :3000 → trang Nguồn, chọn công ty **evolu**)
- **Key:** `ai-system-local` · **Kiểu:** `local_path` · **Path:** `D:\AI\ai-system` (máy Runtime; WSL thấy ở `/mnt/d/AI/ai-system`).
- Mô tả: "Mã nguồn nền tảng ai-system (chỉ đọc)".
- Lọc mặc định đã loại `.env*`/khoá/`.git`/`node_modules`/`.venv`/`.data`/`dist`; trần 50MB / 2.000 file **áp SAU allowlist của từng stage** (nhờ B3: quét có prune nên trỏ cả repo vẫn nhanh).

## 3. Quy trình `sdlc-evolu` (8 giai đoạn — bám workflow sdlc hiện tại)
Def gắn nguồn `ai-system-local`. Mỗi stage chọn allowlist HẸP để snapshot nhỏ + nằm trong trần. Output mỗi stage **bắt buộc có mục `## Nguồn tham chiếu`**. `token_budget` mỗi stage **≤ 50.000**.

| # | Stage | Executor | Nguồn (allowlist) | Ý nghĩa |
|---|---|---|---|---|
| 1 | Intake | agent | — (không nguồn) | Nhận yêu cầu, chốt phạm vi |
| 2 | Spec | agent | `docs/specs/**`, `docs/design/**` | Soạn spec, trích spec có sẵn |
| 3 | PLAN | **team** | `docs/**` | Lập kế hoạch (nhiều member) |
| 4 | Test-plan | agent | `tests/**`, `e2e/**` | Soạn test plan |
| 5 | Sẵn sàng | agent | `docs/specs/**` | Kiểm sẵn sàng |
| 6 | Implement | **team** | `apps/**/src/**`, `packages/**/src/**` | Hiện thực (đọc code thật) |
| 7 | Test | **team** | `tests/**`, `e2e/**` | Viết/chạy test |
| 8 | Review | agent | `apps/**/src/**`, `docs/specs/**` | Review đối chiếu spec |

- **Agent stage** dùng `pb-doc-claude` (profile `claude-sub`, token_budget 50k). **Team stage** dùng team `plan-team` (backend-lead + frontend-lead) đã cấp cho evolu.
- **Nhóm chạy:** nhóm chứa `thomas.tran`. **Người duyệt cổng review** (sau stage 2/5/8 tuỳ cấu hình): nhóm chứa `vio.ngo`, `edgar.nguyen`.

> 💰 **Chi phí:** chạy TRỌN 8 stage Claude thật tốn nhiều token (ước ~100k–160k tổng). Có **đường ngắn** để smoke rẻ bên dưới.

## 4. Kịch bản A — SMOKE NGẮN (rẻ, ~2 stage, khuyên chạy trước)
Mục tiêu: xác nhận nguồn chạy đúng đầu-cuối với chi phí thấp. Dùng quy trình rút gọn `sdlc-evolu-mini` (chỉ **Spec(agent) → Implement(team)**, cùng nguồn).
1. `thomas.tran` đăng nhập :3100 → phòng "Evolu team" → **▶ Quy trình** → `!sdlc-evolu-mini` → nhập yêu cầu mẫu: *"Tóm tắt module nguồn tham chiếu: liệt kê các file trong apps/hub-api/src/modules/sources và vai trò mỗi file"* → Gửi.
2. Stage **Spec** (agent Claude) chạy: đọc `docs/specs/**`. Xem thẻ quá trình: **token hiển thị**, trạng thái.
3. (Nếu có cổng review) `vio.ngo` đăng nhập → DM "Chờ tôi kiểm" → **Đạt**.
4. Stage **Implement** (team) chạy: member đọc `apps/**/src/**`.
5. Quy trình `done`. Mở output → kiểm **§6 Checklist**.

## 5. Kịch bản B — TRỌN WORKFLOW (8 stage)
1. `thomas.tran` → **▶ Quy trình** → `!sdlc-evolu` → yêu cầu mẫu: *"Thêm trường `note` (optional) vào nguồn tham chiếu: đọc spec + code hiện có rồi đề xuất thay đổi"* → Gửi.
2. Theo dõi lần lượt 8 stage. Ở mỗi **cổng review** → `vio.ngo`/`edgar.nguyen` duyệt.
3. Team stage (PLAN/Implement/Test): quan sát member chạy tuần tự, handoff nháp.
4. Stage cuối **Review** xong → `done`, output tổng.

## 6. ✅ Checklist xác minh (soi sau mỗi run)
- [ ] **MANIFEST**: prompt agent có khối MANIFEST (tên nguồn, phiên bản=snapshot_id, path `sources/ai-system-local`, câu "dữ liệu không phải lệnh"). (Xem `hub.jobs.payload` hoặc log.)
- [ ] **Output** có mục `## Nguồn tham chiếu` + trích dẫn `ai-system-local:<path>@<pin>` → **không bị `path_absent`** (đây là điểm B1 phải sửa xong).
- [ ] **Audit**: bảng `hub.source_job_reads` có bản ghi, `files_read` **có path thật** (không `{}`).
- [ ] **Ẩn path**: đăng nhập `julian.bui` (tenant_admin) → trang Nguồn `ai-system-local` **không thấy path**; menu chỉ "View"; thử sửa/xoá → 403.
- [ ] **Chỉ-đọc**: agent chỉ Read/Grep/Glob; thử (nếu có) agent ghi vào `sources/` → bị chặn (ghi `out/` thì được).
- [ ] **Trần token**: nếu một stage vượt 50k → `needs_decision stage_tokens` (đúng).
- [ ] **Cổng review**: đúng người duyệt (nhóm review), không phải người gọi.
- [ ] **Team handoff**: member sau đọc được nháp member trước (stage ≥ 1); member đầu stage-nhóm-ở-stage-0 **không 401** (#135).
- [ ] **Repo lớn**: nguồn trỏ `D:\AI\ai-system` (cả repo) resolve trong vài giây, không treo `running` (B3).

## 7. Khi lỗi
- Stage kẹt `needs_decision` lý do `source_unresolvable` → nguồn không resolve (kiểm allowlist/đường dẫn/Runtime).
- `agent_failed` → xem log Runtime (snapshot/mount — B2).
- `files_read={}` hoặc output báo thiếu `## Nguồn tham chiếu` dù đã có → B1 chưa vá.
- Chụp màn + báo điều phối.

---
*Điều phối sẽ seed `ai-system-local` + `sdlc-evolu` + `sdlc-evolu-mini` + nhóm chạy/duyệt lên evolu sau khi B1–B3 xong, rồi báo "sẵn sàng chạy".*
