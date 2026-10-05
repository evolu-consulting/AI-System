# H3a — Quyết định

## Trước SPEC — người dùng đã chốt (không hỏi lại)
| # | Quyết định | Áp vào |
|---|---|---|
| U1 | (2026-10-05, CR-041) API key chỉ dùng ở **Dify**; Hub chạy **Claude subscription** `claude-sub`. H2d (Model Gateway/API, `llm`/`python`, fallback sang API, Codex/Gemini) **hoãn** — H3a không có provider API, không fallback | §1, R07, AC-W02 |
| U2 | (2026-10-05) Không chạm Dify thật; smoke chỉ `claude-sub`; e2e tích hợp 3 app chờ người dùng ghép | §7, AC-07, AC-12 |
| U3 | Phiên Hub/Worker: code H3 chỉ ở `apps/hub-api`, `apps/agent-runtime`, `packages/**`; UI Admin/Chat → CR-impact cho phiên Chat/Admin | §5 |
| U4 | Trên `main`, không push | — |
| U5 | (2026-10-06) **Chu kỳ probe 20 phút** (`AGENT_RT_PROBE_S=1200`); Q3 phần còn lại và Q1, Q2, Q4–Q7 theo mặc định | R11, R12, K1, Q3 |

## D1 · Chia H3 thành mốc con (docs-architect đề xuất, ghi ROADMAP)
H3 gộp 3 khối độc lập, ước > 3 000 dòng diff, chạm 3 nhóm rủi ro cao khác nhau (subscription/khoá provider · quyền · quota/chi phí) → chia như H2:

| Mốc con | Nội dung | Mã | Vì sao thứ tự này |
|---|---|---|---|
| **H3a** (spec này) | Subscription `claude-sub`: probe → `provider_state`, hết quota/giới hạn, lỗi rõ | WRK-FR-22, 15; CR-041 | Hub chạy **chỉ** bằng một subscription: hết quota/mất đăng nhập là ngưng dịch vụ agent; rủi ro H1 "hết quota thật" còn mở; nhỏ, chủ yếu Python, không phụ thuộc Admin |
| **H3b** | `/agent-grants` (GET/POST/DELETE) + `GET /agent-grants/effective/:user_id` (Kiểm tra quyền phần agent — đóng M5 phần agent) + trace API `GET /runs/:id/trace` + xem trace theo role + audit `view_trace` | HUB-FR-78, 79, 52, 87; HUB-BR-17; ADM-FR-37 (vế Hub) | Không phụ thuộc H3a/H3c; UI Admin (trang Groups, Kiểm tra quyền) → CR-impact |
| **H3c** | Quota (đếm, `overage`, `run.started.quota`, NOTIFY `quota_threshold`), chặn cứng `QUOTA_BLOCKED`, `price_book` → `billable_usd` (+ tính lại khi thêm giá), báo cáo usage | HUB-FR-81, 82, 83, 84, 93, 53; HUB-BR-16 | Cần cột Admin `tenant_quotas.hard_block` (CR-034, phiên Admin) và phải khớp Admin M4 (`/admin/usage` đã có ở admin-api, evaluator ngưỡng Q2b M4) — câu hỏi riêng khi spec H3c |

Ghi chú cho H3c (để không phá M4): Admin M4 đã có `GET /admin/usage` (admin-api đọc `hub.usage_logs`, M4-R03/R08) và tự đánh giá ngưỡng khi nhận NOTIFY `quota_threshold {tenant_id}` (M4 spec-decisions Q2b). BA-H §9.1 ghi Hub cũng có `GET /admin/usage` → khi spec H3c: mặc định đề xuất **Hub không làm endpoint trùng**; Hub chỉ ghi đúng `usage_logs` (`billable_usd`, `overage`, `feature_id`) + gửi NOTIFY; chiều agent/provider của HUB-FR-53 là CR cho Admin nếu cần.

## Câu hỏi mở (mỗi câu có mặc định — Luật 2b: không trả lời ⇒ dùng mặc định)

### Q1 · Hết quota thì chuyển sang tài khoản subscription khác? (WRK-FR-21 vế subscription → subscription)
| Lựa chọn | Nội dung | Hệ quả |
|---|---|---|
| **A (đề xuất)** | **Chưa làm** — hiện chỉ có một tài khoản. Hết quota ⇒ lỗi rõ R08 tới giờ reset | Gọn; khi có tài khoản thứ hai: thêm provider `claude-sub-2` (đăng nhập riêng, `CLAUDE_CONFIG_DIR` riêng) + dùng lại cơ chế profile nhiều bước (WRK-FR-21) — mốc sau |
| B | Làm ngay: profile `claude-sub` → `claude-sub-2`, job tạo lại với bước kế | Cần tài khoản thứ hai + quản lý nhiều thư mục đăng nhập trên Worker; cần kiểm điều khoản gói (K5) |

**Mặc định: A.**

### Q2 · Nhận diện hết quota từ Claude CLI bằng gì?
Đọc code: H1 đã nhận diện bằng 3 tín hiệu (spec §0). "Kết luận H1": chữ **hết quota thật** + giờ reset trong text **chưa đo**. SDK 0.2.163 có `RateLimitEvent` với `resets_at`, `rate_limit_type`, `utilization`, `allowed_warning` — chưa đo CLI subscription phát đủ hay không.

| Lựa chọn | Nội dung |
|---|---|
| **A (đề xuất)** | Giữ 3 tín hiệu H1 (R01); thêm đọc `allowed_warning`/`utilization`/`rate_limit_type` (R03); kiểm biên `resets_at` (R02); log khoá `raw` (R04) để **S2** xác minh khi gặp thật; không thêm mẫu chữ đoán |
| B | Thêm mẫu chữ đoán (vd "limit reached", "resets at …") và parse giờ trong chữ | Có thể bắt thêm ca, nhưng là bịa hành vi CLI — trái luật "không bịa API" |

**Mặc định: A.** Spike S2 không chặn mốc.

### Q3 · Chu kỳ probe
| Lựa chọn | Nội dung |
|---|---|
| **A (chốt — người dùng 2026-10-06: 20 phút)** | **20 phút** `AGENT_RT_PROBE_S=1200` (BA-W §3 ghi 5 phút — lệch, ghi CR khi đóng mốc cùng Q4); bỏ lượt khi có job thành công trong chu kỳ (R12); probe ngay khi khởi động / `cooldown_until` qua; `logged_out` mỗi 60 s (R13) |
| B | Probe cố định 5 phút, không bỏ lượt | Đơn giản hơn; tốn quota gói ~288 lượt/ngày |
| C | Không probe định kỳ, chỉ probe khi khởi động + khi `cooldown_until` qua | Ít tốn nhất; `logged_out` phát hiện muộn (chỉ khi user gửi tin) |

**Mặc định: A.**

### Q4 · Probe là job trong `hub.jobs` (`maint.probe`, BA-W §3) hay vòng lặp trong Runtime?
| Lựa chọn | Nội dung |
|---|---|
| **A (đề xuất)** | Vòng lặp trong Runtime + khoá advisory theo provider (R11) — như sweeper H2c trong Hub; không thêm loại job, không ai phải lập lịch enqueue |
| B | Job `maint.probe` (Hub hoặc cron enqueue) | Đúng chữ BA; cần bộ lập lịch + job chiếm slot `max_concurrency` của provider |

**Mặc định: A** — ghi lệch chữ BA-W §3 vào CR khi đóng mốc (docs-architect I3).

### Q5 · Câu lỗi cho user có ghi giờ mở lại không?
| Lựa chọn | Nội dung |
|---|---|
| **A (đề xuất)** | Không: câu tĩnh theo lý do (R08), contract chat không đổi, giữ H1-R26 (không tham số động) |
| B | Có: thêm `details.retry_at` vào `run.failed` (contract chat **chỉ thêm**) + Chat hiện giờ | Rõ hơn cho user; cần CR-impact Chat; lộ nhịp hạn mức gói ra client |

**Mặc định: A.**

### Q6 · Cách probe (spike S1)
| Lựa chọn | Nội dung |
|---|---|
| **A (đề xuất)** | Làm S1 trước PLAN chốt: nếu CLI bản đang ghim có cách kiểm đăng nhập không gọi model → dùng cho vế đăng nhập; vế quota luôn cần lượt tối thiểu R14(b) (chỉ khi R12 không bỏ lượt). Chưa có kết quả S1 → PLAN theo (b) |
| B | Chỉ (b), bỏ S1 | Đơn giản; mỗi probe tốn một lượt nhỏ |

**Mặc định: A.**

### Q7 · Ai được báo khi `logged_out` / `cooldown` / `allowed_warning`?
| Lựa chọn | Nội dung |
|---|---|
| **A (đề xuất)** | Chỉ log (`warn` cho `logged_out`) + `provider_state`; runbook đọc log/SQL. UI ở Studio H4 |
| B | Thêm NOTIFY/email cho `platform_admin` | Cần kênh Admin mới → CR-impact Admin |

**Mặc định: A.**

## Spike S1 — cách probe
(chưa chạy — backend-lead ghi kết quả: lệnh đã thử, bản CLI, token/thời gian một lượt, có `RateLimitEvent` không)

## Spike S2 — tín hiệu hết quota thật
(chưa gặp — ghi khi log `claude.rate_limit` có `rejected`/`allowed_warning` thật)

## Quyết định trong lúc làm
- (trống)
