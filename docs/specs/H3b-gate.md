# Gate H3b — Quyền agent `/agent-grants`, Kiểm tra quyền phần agent, trace theo role

Ngày: 2026-10-06 · Trạng thái: **ĐÃ DUYỆT 2026-10-06 — Tự duyệt theo Luật 2b** · Readiness: READY (`H3b-agent-grants/readiness.md`, 2 lần; còn L1–L5 mức Thấp)

**Vì sao tự duyệt:** spec-readiness READY. Mọi lỗ hổng Cao của lần 1 (N1, N2, G4, G8) đã đóng. Bốn câu nghiệp vụ Q-U1–Q-U4 người dùng đã chốt theo mặc định (U6, 2026-10-06). Không có câu hỏi mới, không ADR, không thư viện mới, không hard stop. Riêng việc mở quyền DB (PL2) readiness đánh giá không cần người dùng duyệt; vẫn ghi ở mục 3 để minh bạch.

## 1. Phạm vi (`H3b-agent-grants/spec.md`)
- **`GET/POST/DELETE /agent-grants`:**
  - Chỉ `tenant_admin`/`platform_admin`; `member` nhận 403. `platform_admin` gửi `?tenant_id` bắt buộc (U6/Q-U1). `tenant_admin` gửi tenant khác nhận 404.
  - Chỉ cấp agent có entitlement chưa thu hồi; không cấp Orchestrator; group/user phải cùng tenant.
  - Grant là tập hợp: cấp trùng hay xoá không có thì không ghi.
  - Mỗi lần ghi có thay đổi, trong một transaction: tăng `hub_config_version`, ghi audit, gửi NOTIFY. Hiệu lực ≤ 5 s.
- **`GET /agent-grants/effective/:user_id`:** dùng đúng luật `visibleAgents` hiện có, trả `reasons` và `missing` theo dạng `EffectiveFeature` của M3.
- **`GET /runs/:id/trace`:**
  - Chủ run xem được, không audit, không thấy `detail.message`/`upstream` (R49/PL15, theo H1).
  - `platform_admin` xem được mọi tenant, ghi audit `view_trace` fail-closed.
  - `tenant_admin` xem run của người khác nhận 404 (Q-U2).
  - Số token giữ nguyên, không bị che (PL16).
- **Audit:** bảng mới `hub.audit_log` (Q-U3), chỉ ghi thêm, trigger chặn sửa/xoá. `view_trace` chỉ ghi khi xem run của người khác (Q-U4).
- **CORS:** thêm origin admin-web.
- **Không làm:** API entitlement (Studio H4), quota/chi phí (H3c), UI Admin (CR-impact cho phiên Admin ở I3).

## 2. Dữ liệu / contract
- Migration `0009`: bảng `hub.audit_log` (3 index), index `usage_logs_run_idx`, GRANT cho `hub_rw`.
- Contract chỉ thêm subpath `@ai/contracts/hub-admin`. Mã lỗi mới nằm trong `HUB_ADMIN_ERRORS`; `CHAT_API_ERRORS` giữ đúng 6 mã.
- Thứ tự khoá: `config_meta` (FOR UPDATE) → `agent_grants` → `audit_log`, cùng chiều với seed.

## 3. Mở quyền DB (PL2, R22)
`hub_rw` thêm:
- `INSERT, DELETE` trên `agent_grants`;
- `UPDATE (hub_config_version)` trên `config_meta`, chỉ đúng một cột;
- `SELECT, INSERT` trên `audit_log`.

Quyền UPDATE một cột là bắt buộc để tăng version trong cùng transaction (R08), giống seed đang làm. Test A-quyền-DB liệt kê tường minh các quyền được phép.

## 4. Test (`test-plan*.md`)
≈ 136 ca mới: unit luật thuần + contract 40, int 91 trong 9 file. Có ma trận cách ly tenant 5 endpoint × 5 vai, đồng thời có `pg_locks` tất định, và seed ∥ POST lặp 10 vòng. AC-13 phần command (5 ca) đặt ở `H3b-cmd/`, ngoài `done:h3b`; đỏ thì ghi TECH-DEBT. Giữ xanh mọi test khoá cũ.

## 5. Rủi ro
- **K8/TECH-DEBT #72:** seed cộng dồn sẽ chèn lại grant đã thu hồi qua API. YAML seed production không được chứa `grants:` (`hub-dev.md`; PRODUCTION-NOTES ở I3).
- Index `usage_logs` trên production lớn cần tạo `CONCURRENTLY` trước khi migrate (PL7, PRODUCTION-NOTES ở I3).
- L1–L5 mức Thấp do backend-lead/qc/docs-architect sửa khi chạm file: đổi `H3b-R49` thành `H3b-R24` và sửa các dải tham chiếu; thứ tự bỏ khoá → che → đo 16 KiB; R22 ghi thêm index; I3 thêm mục PRODUCTION-NOTES; test-plan §9 bỏ dòng cũ G2/G3/G13.

## 6. Thứ tự BUILD
Theo `H3b-agent-grants/tasks.md`: D1 ∥ C1 ∥ B0 ∥ MK → qc QW → Q2 → B1 → B2 → B3 → B4 → B5 ∥ B6 → I1 `done:h3b` (+ qc chạy tay `H3b-cmd`) → review ≤ 2 vòng → I2 kiểm tay curl → I3 docs. Trên `main`, không push.
