# H3b — Quyết định

## Trước SPEC — người dùng đã chốt (không hỏi lại)
| # | Quyết định | Áp vào |
|---|---|---|
| U1 | Phiên Hub/Worker: code H3b chỉ ở `apps/hub-api`, `apps/agent-runtime`, `packages/**`; UI Admin (tab Agent của group, Kiểm tra quyền phần agent) → **CR-impact phiên Admin** (như CR-040/CR-042), không có task UI trong phiên này | spec §1, §5 |
| U2 | Không chạm Dify thật; e2e tích hợp 3 app chờ người dùng ghép xong rồi yêu cầu | spec §7 |
| U3 | Trên `main`, không push; commit `git add -N` + `git commit -o` | — |
| U4 | Hiệu năng ưu tiên thấp: nới ngưỡng, đo ở `test:perf`, không chặn mốc | spec §6 |
| U5 | (CR-017, M3) UI Admin chỉ cấp cho group; cấp cho user chỉ có API — áp tương tự cho agent | spec R04, §5 |
| U6 | (2026-10-06) **Q-U1–Q-U4 theo mặc định:** Q-U1 `platform_admin` cấp/thu cho tenant khác với `?tenant_id` bắt buộc (tenant_admin chỉ tenant mình); Q-U2 tenant_admin mở trace run người khác ⇒ 404; Q-U3 audit Hub ở bảng mới `hub.audit_log` (CR cho Admin gộp trang Nhật ký); Q-U4 ghi `view_trace` chỉ khi xem run của người khác | Q-U1–Q-U4 |

## D1 · Phạm vi H3b (docs-architect)
Theo ROADMAP H3b + D1 của H3a: một spec (ước diff Hub TS ≈ 1 200–1 500 dòng: 3 endpoint grant + effective + trace + migration + audit). Không tách thêm vì cả ba khối dùng chung "role + tenant đích + audit Hub". Entitlement API (platform_admin) để H4 vì BA đặt ở Studio (`/studio/api/agent-entitlements`).

## Câu hỏi cần người dùng quyết (nghiệp vụ / bảo mật) — không trả lời ⇒ mặc định (Luật 2b)

### Q-U1 · `platform_admin` cấp agent cho group của tenant **khác** tenant trong JWT?
BA-H §9.1 ghi "chỉ trong đúng `tenant_id` của JWT"; nhưng ui-admin §5 cho `platform_admin` ô chọn tenant ở trang Groups, và Admin M3 `/admin/grants` nhận `?tenant_id` cho `platform_admin`.
| Lựa chọn | Nội dung |
|---|---|
| **A (đề xuất)** | `platform_admin` truyền `?tenant_id` (bắt buộc, vắng → 400 `TENANT_REQUIRED`) — giống Admin M3; `tenant_admin` luôn tenant JWT, `tenant_id` khác → 404. Cập nhật câu BA-H §9.1 khi đóng mốc |
| B | Đúng chữ BA: chỉ tenant JWT cho cả hai role ⇒ `platform_admin` không cấp được cho tenant khách (chỉ qua seed/H4) — trái màn Groups của Admin |

**Mặc định: A.**

### Q-U2 · `tenant_admin` mở trace run của user **khác** trong tenant mình?
HUB-FR-52/87, BR-02: `tenant_admin` "chỉ xem chi phí, không xem nội dung".
| Lựa chọn | Nội dung |
|---|---|
| **A (đề xuất)** | **404** như người ngoài; chi phí xem ở Admin "Chi phí & quota" (M4 đã có). Đơn giản, không có đường lộ nội dung |
| B | 200 **chỉ metadata** (step, agent, thời gian, token, chi phí; không tin, không `detail`) + audit `view_trace` | Thêm một hình trace thứ hai + luật che theo trường — rủi ro lọt nội dung qua `detail`/`label` |

**Mặc định: A.** Mở rộng B sau không phá contract (thêm nhánh).

### Q-U3 · Audit của Hub (cấp/thu grant, `view_trace`) lưu ở đâu, Admin "Nhật ký" có hiện không?
Schema `hub` chưa có bảng audit; `admin.audit_log` (M4) Hub chỉ đọc, CHECK `action`/`entity` không có `view_trace`/`agent_grant`.
| Lựa chọn | Nội dung |
|---|---|
| **A (đề xuất)** | Bảng mới `hub.audit_log` (append-only, cấu trúc theo `admin.audit_log`, có `tenant_id`) — đúng BA-H §8 "`audit_log` … áp dụng cho cấu hình và quyền agent của Hub"; Studio (H4) đọc. Admin "Nhật ký" **chưa** hiện các hàng này → CR-impact Admin (đọc hợp nhất khi cần; cấp `SELECT` cho `admin_rw`) |
| B | Hub ghi thẳng `admin.audit_log` (phiên Admin mở `INSERT` cho role Hub + thêm giá trị CHECK) | Tenant admin thấy ngay trong Nhật ký; nhưng Hub ghi schema `admin` — trái nguyên tắc sở hữu (architecture), phải đổi migration phía Admin |

**Mặc định: A.**

### Q-U4 · Ghi `view_trace` khi nào?
BA-H HUB-FR-87: "mỗi lần xem trace"; ui-operations §8: "mỗi lần mở trace *của người khác*".
| Lựa chọn | Nội dung |
|---|---|
| **A (đề xuất)** | Chỉ khi người xem **không phải chủ run** (mỗi lần gọi một hàng); chủ run xem run của mình không ghi |
| B | Mọi lần, kể cả chủ run | Bảng audit phình theo mỗi lần user mở chi tiết run của mình, không có giá trị kiểm soát |

**Mặc định: A.**

## Câu hỏi kỹ thuật — tự quyết theo mặc định (backend-lead có thể đổi ở PLAN, ghi lý do)
| # | Câu hỏi | Mặc định | Nguồn |
|---|---|---|---|
| Q-K1 | Admin gọi `/agent-grants` qua admin-api (proxy) hay thẳng Hub? | **Thẳng Hub** bằng JWT của admin đang đăng nhập — BA-A §8 ("Admin UI gọi sang `hub/agent-grants` bằng JWT của tenant admin"), BA-H §2, §6.8, §9.1, architecture §2. admin-api hiện không gọi Hub; không thêm proxy | BA, code |
| Q-K2 | CORS | `HUB_CORS_ORIGINS` thêm origin admin-web (dev `http://localhost:3000`); `.env.example` + `docs/guides/hub-dev.md` | `config/env.ts` |
| Q-K3 | `member` gọi `/agent-grants*` | 403 `FORBIDDEN` (không phải tài nguyên theo tenant; khớp Admin API). 404 chỉ dùng cho tenant/tài nguyên khác (BR-14) | BA-A `API_ERRORS` |
| Q-K4 | Dạng DELETE | Query `?agent_id&subject_type&subject_id` (như M3 `GrantDeleteQuery`), idempotent 204; không thêm `/:id` | M3 |
| Q-K5 | Batch nhiều agent một lần | Không ở H3b (số agent/tenant nhỏ); POST một grant/lần. Admin cần batch → CR sau | — |
| Q-K6 | RLS cho `agent_grants` | Không thêm (bảng cấu hình, cache nạp toàn bộ bằng một role); cách ly ở repo + test chéo (R03). Migration chỉ thêm `GRANT INSERT, DELETE ON hub.agent_grants` cho role Hub. Reviewer Opus kiểm mọi câu | `0000` |
| Q-K7 | NOTIFY trong hay sau transaction | **Trong** transaction (`pg_notify`, giao khi commit) như `seed.repo.ts`; rollback/retry 40P01 không gửi — khác Admin M3 (sau commit) nhưng tương đương về đúng/sai | `seed.repo.ts`, TECH-DEBT #13 |
| Q-K8 | Grant mồ côi (group/user bị Admin xoá) | Lọc bằng join `admin.groups`/`admin.users` (hub_ro) ở R11/R13; không xoá tự động; ghi TECH-DEBT dọn định kỳ | TECH-DEBT #15 |
| Q-K9 | Agent tắt / runtime chưa chạy được | Vẫn cấp được; effective trả `agent_disabled`/`runtime_unavailable` | M3-R07 |
| Q-K10 | Ghi `view_trace` lỗi | Fail-closed: 500, không trả trace (R19) | HUB-FR-87 |
| Q-K11 | Vế Hub AC-A03/A10/A11 phần **command** (đầu vào M5, CR-015) | qc thêm test int trên code H2a (AC-13), không code mới; đỏ → TECH-DEBT, không chặn H3b | ROADMAP M5 |
| Q-K12 | Contract đặt ở đâu | Gói con mới `@ai/contracts/hub-admin` (không động `chat`); backend-lead chốt tên | H2a Q3 |
| Q-K13 | Kiểu Drizzle `agentGrants` đang ở `hub-readonly.ts` (stub Admin đọc) | Giữ export cho Admin; Hub dùng cùng định nghĩa để ghi (không khai trùng) — backend-lead chốt | `hub-readonly.ts` |
| Q-K14 | Smoke thật | Không cần (`fake-cli` + mock Dify đủ); I2 chỉ chạy Hub dev + `curl` 3 endpoint với JWT dev | U2 |

## Quyết định trong lúc làm
(chưa có)
