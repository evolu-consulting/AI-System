# Phụ lục plan · Seed quy trình mẫu (D18)

Người dùng 2026-10-10: mẫu SDLC **lấy đúng flow đang dùng của repo** (`docs/WORKFLOW.md` "Vòng một mốc" + Luật 0/1 `CLAUDE.md`): từ yêu cầu → spec → implement → test. Ghi đè dòng "SDLC 5 stage" ở `plan.md` §8 (0c). Mẫu hoá đơn giữ như plan.

## Mẫu `sdlc` — "Phát triển tính năng (AI-SDLC)" (`tenant_id` null, chép được)

| # | Giai đoạn (stage) | Làm bởi | Output (template Hub kiểm) | Sau giai đoạn | Ứng với WORKFLOW |
|---|---|---|---|---|---|
| 1 | Intake | agent `intake-analyst` | `intake.md`: `## Bảng ý` · `## Ảnh hưởng` · `## CR đề xuất` · `## Câu hỏi` | 🔒 Người kiểm Group "PO" (chốt kết quả Intake; câu hỏi dùng **hỏi lại** HUB-FR-110 tới người khởi chạy) | Luật 0 |
| 2 | Spec | agent `docs-architect` | `spec.md` theo `docs/specs/_template` (frontmatter mã yêu cầu, phạm vi, luật, AC) | Tự chạy tiếp | Vòng mốc bước 1 |
| 3 | PLAN | nhóm `plan-team` (tuần tự: `backend-lead` → `frontend-lead`) | `plan.md`: `## Contract` · `## DB` · `## Frontend` · `## Tasks` | Tự chạy tiếp | bước 2 |
| 4 | Test-plan | agent `qc` | `test-plan.md`: `## Ca theo AC` · `## Ma trận luật` | Tự chạy tiếp | bước 3 |
| 5 | Sẵn sàng | agent `spec-readiness` | `readiness.md`: `verdict: READY\|NOT READY` · `## Lỗ hổng` | 🔒 ★ Gate — Group "Tech lead" duyệt gói spec · plan · test-plan | bước 4–5 (Luật 1) |
| 6 | Implement | nhóm `dev-team` (tuần tự: `backend-lead` → `frontend-lead`) | `implement.md`: nhánh/PR · task đã xong · lệnh test + kết quả | Tự chạy tiếp | bước 7 |
| 7 | Test | nhóm `test-team` (tuần tự: `qc` → `qc-uat`) | `test-report.md`: `verdict: PASS\|FAIL` · độ phủ theo AC · evidence | Tự chạy tiếp | bước 8 + UAT |
| 8 | Review | agent `reviewer` | `review.md`: `verdict: APPROVED\|CHANGES` · Blocker/Major/Minor | 🔒 Group "Tech lead" — Đạt = xong lượt chạy | bước 9 |

Ghi chú
- Agent seed mang **đúng tên vai** trong `.claude/agents/` (`intake-analyst`, `docs-architect`, `backend-lead`, `frontend-lead`, `qc`, `qc-uat`, `spec-readiness`, `reviewer`). Dev/test: `fake-cli` (như plan 0c). Prompt thật lấy từ file `.claude/agents/<vai>.md` khi chạy agent thật — ngoài P-a.
- Nhóm seed thêm: `plan-team`, `dev-team`, `test-team` (cùng `sequential`, giới hạn mặc định `agent_teams.limits`). Nhóm `ba-team` giữ (dùng cho spike/ví dụ, không thuộc mẫu `sdlc`).
- 8 giai đoạn ≤ trần 10 (`process_defs.stages` 1..10).

## Giới hạn ở P-a (ghi rõ để không hiểu nhầm)
| Điểm | P-a | Khi nào đủ |
|---|---|---|
| Giai đoạn 6–7 sửa code thật trong repo | **Không** — agent chạy trong sandbox `work/<job_id>/`, chưa có workspace code chung / git / PR. Với `fake-cli` chỉ sinh output mẫu để test máy trạng thái | P-c (HUB-FR-119, cần H4b Secrets) |
| "Chưa đạt" ở Gate (5) / Review (8) quay về giai đoạn sớm hơn (vd về 2 Spec hoặc 6 Implement) | **Không** — P-a chỉ làm lại **chính giai đoạn đó** kèm góp ý | P-b tự quay lại (HUB-FR-118) — khi đó: Gate Chưa đạt → về 2; Test `FAIL` → về 6 (≤ 3 vòng); Review `CHANGES` → về 6 (≤ 2 vòng, khớp WORKFLOW bước 9) |
| Tự quyết theo `verdict` (READY / PASS / APPROVED) | Không — có người kiểm ở 1, 5, 8; 2–4, 6–7 tự chạy tiếp | P-b luật tự duyệt (HUB-FR-108) trên trường `verdict` |
| Merge PR (Hành động thật) | Không có giai đoạn 9 | P-c: thêm giai đoạn 9 "Merge" (`real_action`) sau Review |

## Ảnh hưởng task
- **B3** (0c): seed `processes.yaml` theo bảng trên + `agents.yaml` thêm 8 agent vai (fake-cli dev) thay 4 agent BA của plan cũ (giữ `ba-team` + 4 agent BA nếu spike/ví dụ cần) + 3 nhóm mới.
- **QC1**: e2e/int dùng mẫu `sdlc` 8 giai đoạn (kịch bản: 3 cổng kiểm, 1 hỏi lại ở Intake, 1 Chưa đạt ở Gate làm lại giai đoạn 5).
