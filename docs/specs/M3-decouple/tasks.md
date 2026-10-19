# M3-decouple · gói contracts không phụ thuộc engine quy trình

Làn: **đầy đủ** cho máy trạng thái duyệt (quyền/tenant/tiền, chuyển dữ liệu run) và AI client (trần theo tenant); làn nhanh cho phần còn lại. Chế độ nhanh Luật 0b (một agent, worktree `slice/m3-decouple`). Mục tiêu: contracts chạy như mgmt-app/sohoptac — chỉ trợ lý chat ở Agent Hub.

## Plan ngắn
1. **AI client chung** `apps/hub-api/src/lib/ai-client/`: `createAiClient` (trần token/tenant/ngày UTC đọc từ bảng TRƯỚC khi gọi, lỗi đọc ⇒ không gọi; gọi provider; ghi một dòng usage), `anthropicProvider` (SDK `@anthropic-ai/sdk` 0.135.0, `claude-opus-5-5` mặc định, `fallbacks: "default"`, stream + `finalMessage`), `pgUsageStore`/`recordAiUsage` (→ `hub.usage_logs` qua `hub.log_ai_usage`, `hub.ai_tokens_since`), `createHubAiClient` (khoá chỉ từ env `ANTHROPIC_API_KEY`; `AI_TENANT_DAILY_TOKENS` mặc định 5.000.000, `0` = không trần), `chatUsageSink` (M2 `recordChatUsage` → cùng bảng, feature `chat`).
2. **Trích (HD2)**: job `contracts:extract:<db>` trên Redis Streams (`adapters/extract-stream.redis.ts`: XADD sau commit; consumer group, XREADGROUP BLOCK trên kết nối riêng, ≤ 2 job/instance, XACK+XDEL; XAUTOCLAIM nhận lại entry treo > hạn lượt AI + 60 s) → `handleExtractJob` → `runExtraction` (lời nhắc có rào, zod strict, kiểm trích dẫn GIỮ NGUYÊN) với transport = `aiTransport(aiClient)` (không tool/MCP). Vắng Redis ⇒ chạy ngay trong tiến trình. Quét `extracting` > 15 phút ⇒ `extract_failed STALE` + lượt `failed` (một câu/tenant).
3. **Duyệt (HD3)**: bảng `contracts.approvals` + `domain/approval-machine.rules.ts` (thuần): extracting → level1 → (≥ ngưỡng/trống) level2 → done | rejected | failed. `approval.usecase.ts` quyết trong MỘT tx khoá HĐ; `finalize` kiểm ngưỡng TRONG câu UPDATE (D3-14); sửa tiền HĐ đã duyệt ⇒ mở lượt cấp 1 trong CÙNG tx PATCH (D3-13); PATCH `total_value` ở cấp 2 ⇒ 409. API/UI giữ nguyên hình dạng (`run_id` = id lượt duyệt, `task_id` khi bước mở).
4. Bỏ mọi import `PackRuns`/`processes` khỏi `packs/contracts`; luật depcruise `contracts-no-process-engine`.

## Migration
- Gói contracts: **0011_m3_approvals** (đổi từ 0010 khi rebase lên platform/gd0 14885aa9 — 0010 = M1b visibility; `when` 1793491200000) (bảng + RLS `packs.secure_table` + chuyển run cũ: mỗi `contracts.run_id` ⇒ một lượt cùng id; bước suy từ trạng thái HĐ và, nếu đọc được, từ `hub.process_runs` — stage ≥ 2 ⇒ level2, run huỷ/lỗi ⇒ cancelled/failed, `started_by` từ run).
- Hub: **0042_m3_ai_usage** (`usage_logs.feature` + `hub.log_ai_usage` + `hub.ai_tokens_since`, EXECUTE `hub_rw`).
- Hub 0042: platform/gd0 mới tới 0041 ⇒ không đổi. HD78 sắp thêm migration gói ⇒ người merge sau đổi số.

## Quyết định trong lúc làm
| Mã | Quyết định |
|---|---|
| M3-01 | Bảng usage chung = `hub.usage_logs` có sẵn (admin usage/quota đã đọc) + cột `feature`; không tạo bảng mới. Trần token/tenant/ngày theo UTC, chỉ tính dòng `feature IS NOT NULL` (lời gọi qua AI client + chat). |
| M3-02 | Thêm thư viện `@anthropic-ai/sdk` 0.135.0 (SDK chính thức; skill claude-api). Cần ADR bổ sung lúc review cuối đợt (người dùng: "làm như recommend"). |
| M3-03 | Model mặc định `claude-opus-5-5` (env `CONTRACTS_EXTRACT_MODEL` ghi đè), `fallbacks: "default"` khi model từ chối. Trần token hết ⇒ HĐ `extract_failed AI_CAP_EXCEEDED`. |
| M3-04 | Seam `contractsAi.transport` (test HD2) giữ đường HD2: không mở lượt duyệt (đếm SQL HD2 khoá ≤ 8 câu). Production + HD3 = chế độ flow. |
| M3-05 | Mở lại duyệt (D3-13) chạy TRONG tx PATCH (không còn HĐ mồ côi, bỏ `orphanReopens`); không thêm event `approval_started` cho lượt mở lại (test khoá HD1 đếm đúng 1 event) — lịch sử = hàng `approvals`. |
| M3-06 | "Trích lại" ở cấp 2 (người KHÁC người bắt đầu) ⇒ về `extracting` rồi cấp 1 (engine cũ chạy lại stage giá trị). HĐ không nguồn ⇒ giữ nguyên bước. |
| M3-07 | Model lỗi ⇒ lượt `failed`, thẻ bước `cancelled` (không "Bị từ chối"); `/extract` mở lượt mới. |
| M3-08 | Khoá stream theo tên DB (`current_database()`) để nhiều DB test chung một Redis không lấy job của nhau. |
| M3-09 | Group duyệt: id theo khoá đọc `admin.groups` (cache 60 s, hụt khoá ⇒ đọc lại) + Group user từ cache cấu hình (`packGroups`). |
| M3-11 | AI chưa cấu hình (không `ANTHROPIC_API_KEY`, không seam): không xếp job, không mở worker; tải lên giữ `extracting` tới quét STALE (hành vi HD1 khi chưa có AI), `/extract` 503 `AGENT_UNAVAILABLE` trước SQL. |
| M3-12 | Tải lên mở lượt duyệt trong CÙNG câu CTE (giữ "1 tx 3 câu" HD-NFR-03, khoá); tệp không đọc được ⇒ không mở lượt. XADD qua kết nối Redis riêng của hàng đợi (không chen lệnh lẻ vào client dùng chung). |
| M3-13 | Usage chat một nguồn: runtime agent đã ghi `usage_logs` mỗi job (cùng tx kết thúc job); Hub chỉ gắn `feature='chat'` cho dòng của run (`hub.tag_chat_usage`), không chèn dòng thứ hai. Run không có dòng ⇒ cảnh báo `chat-usage-missing`. |
| M3-14 | PDF hợp đồng (D3-04): chế độ flow tải tệp từ FileBox ⇒ `PdfConverter` (unpdf, ADR-0028) ⇒ chữ vào lời nhắc + kiểm trích dẫn; scan ⇒ `PDF_NEEDS_OCR`; ảnh vẫn `AGENT_UNAVAILABLE`. Seam HD2 giữ tệp đi thẳng agent (test khoá). |
| M3-10 | Run engine `contracts-approval` đang mở lúc chuyển dữ liệu KHÔNG bị huỷ (migration gói không ghi schema hub); tool `contracts-*` đã gỡ ⇒ run cũ sẽ lỗi tool ở engine. Việc còn lại: admin huỷ các run đó. |

## Bảng ánh xạ test HD3 (qc, điều phối 2026-10-20) — không bỏ luật nào
| Test cũ | Test mới | Luật |
|---|---|---|
| flow AC31a·AC32a (job `allowed_tools=[]`, `hub.process_runs.started_by`) | flow AC31a·AC32a (yêu cầu model không có trường tool/MCP, lời nhắc có rào; `approvals.started_by`, tenant; usage ghi) | mở lượt + AI không tool + người bắt đầu |
| flow HD-FR-31 EXTRACT_BUSY | giữ (+ `run_id` không đổi) | lượt sống ⇒ 409 |
| flow AC33a (`hub.review_tasks` 1 review, run done) | AC33a (`approvals` done, level1_by = decided_by = B) | < ngưỡng ⇒ bỏ cấp 2 |
| flow AC33b·AC34d (waitStatus done) | AC33b·AC34d (`approvals` done, decided_by H) | editor cấp 1, owner cấp 2, người bắt đầu bị chặn |
| flow AC33c, AC33d, AC37a | giữ nguyên | đúng ngưỡng ⇒ cấp 2; giá trị hiện tại; ngưỡng tenant + quyền admin |
| flow AC34b (run cancelled) | AC34b (`approvals` rejected + feedback) | từ chối cần lý do |
| flow D3-06 (từ chối qua `/review-tasks` chat-web) | **bỏ** (UI engine đóng băng); thay bằng AC34b cấp 2 (owner từ chối, sau đó 409) | từ chối vẫn phủ ở cả 2 cấp trên contracts-web (e2e `hd3-flow.cw.ts` Từ chối) |
| flow redo (nextStageJob/jobDone) | redo (model giả trả kết quả mới, chờ `extracted`) | trích lại ở cấp 1 |
| guard D3-13 (waitStatus, 4 event) | D3-13 (lượt cũ done giữ, lượt mới level1 do B; 3 event — M3-05) | sửa tiền ⇒ mở lại duyệt |
| guard D3-13 non-money, 409 cấp 2 | giữ (bỏ waitStatus) | trường khác không mở lại; 409 khi đang duyệt |
| guard finalize đọc lại (sửa `hub.process_defs`) | D3-14 (gọi `finalize` lách cấp 2 ⇒ 0 hàng; Xác nhận thật ⇒ level2) | finalize kiểm ngưỡng trong UPDATE |
| guard M1 audit | giữ | đổi cài đặt có nhật ký |
| guard AC37b (def `approve.after.group_id`) | AC37b (Group cấp 2 mới quyết; owner cũ 403 NOT_REVIEWER; Group thiếu ⇒ 422) | Group cấp 2 theo cài đặt |
| guard m4 run failed ⇒ FLOW_FAILED | m4 model lỗi ⇒ `extract_failed AGENT_FAILED`, lượt failed, bước cancelled | lỗi kỹ thuật ≠ bị từ chối |
| isolation AC34c | giữ | tenant khác 404, không vai 403 |
| isolation AC34g (def acme từ beta) | AC34g (không có def `contracts-approval` nào; acme lẫn beta 404) | không chạy được flow ngoài gói |
| isolation AC32b (def tự dựng gọi tool finalize) | AC32b·AC34f (finalize/từ chối bằng lượt của HĐ khác / id tuỳ ý ⇒ 0 hàng) | ghi chỉ chạm HĐ của lượt |
| reverify TOCTOU | giữ nguyên | finalize chờ khoá, đánh giá lại |
| reverify mồ côi (sweep mở lại run) | mở lại trong tx: lỗi ⇒ PATCH rollback, HĐ giữ "Đã duyệt"; hết lỗi ⇒ lượt cấp 1 do B | không HĐ mồ côi |
| reverify passedStages `use_current` | quyết cấp 2 hợp lệ của H ⇒ Đã duyệt dù ≥ ngưỡng | quyết cấp 2 hợp lệ được tính |
| sweep D3-06 (chat-web reject ⇒ quét) | **bỏ phần UI engine**; thay: lượt AI mất (`extracting` > 15') ⇒ STALE + lượt failed, lượt 2 closed 0 | quét idempotent #218 |
| sweep #218, AC35a | giữ | STALE; 100 lượt AI/ngày ⇒ 429 |
| starter-decision (engine N2) | giữ nguyên (không chạm contracts) | luật engine D3-07 |
| perf | giữ nguyên | quét lô 100 p95 ≤ 50 ms; GET approval p95 ≤ 30 ms |

Redis lỗi khi đếm trần ⇒ 503: unit `adapters/action-quota.test.ts` (không đổi).

## Test mới
- Unit: `domain/approval-machine.rules.test.ts` (mọi luật bước), `domain/approval-def.rules.test.ts` (ngưỡng), `lib/ai-client/ai-client.test.ts`.
- Int: `tests/acceptance/M3D/extract-queue.int.test.ts` (hàng đợi bền: xử lý + ACK, consumer chết ⇒ XAUTOCLAIM, entry hỏng, tách khoá), `tests/acceptance/M3D/ai-usage.int.test.ts` (usage theo tenant, trần, đóng an toàn, usage chat M2), RLS `contracts.approvals` trong `packages/test-kit/src/rls-packs.int.test.ts` (`defineRlsSuite`).

## Việc còn lại
- [x] ADR-0029 `@anthropic-ai/sdk` (Accepted).
- [x] PDF có lớp chữ (M3-14). Còn: OCR PDF scan / ảnh (ADR riêng).
- [x] Đóng run engine cũ: `bun tools/scripts/src/m3-close-contract-runs.ts` (chạy thử) rồi `--apply` một lần sau deploy (cần `DATABASE_URL` chủ migration); `pack-runs-hd3.ts` đã gỡ.
- [x] Usage chat một nguồn (M3-13).
- [ ] Trần token riêng theo tenant (bảng quota admin) thay env chung.