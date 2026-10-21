# ai-tiers-rag — bậc model + RAG tài liệu nội bộ trong chat (lát nhanh, Luật 0b)

## Plan ngắn
| # | Việc | Làn | Trạng thái |
|---|------|-----|-----------|
| 1 | Bậc model fast/std/deep (`providers.yaml`), token `$HUB_SEED_PROFILE:<bậc>` (`seed.rules.resolveSeedProfile`), gán agent | nhanh | xong |
| 2 | Runtime: làn `claude-sub-haiku` / `claude-sub-opus` (cùng CLI, `provider_state` riêng), tự claim khi có `claude-sub` | nhanh | xong |
| 3 | Cấp `knowledge-search`/`knowledge-get` (tool gói có sẵn, quyền người gọi + RLS) cho `assistant`, `mgmt-assistant`; prompt trích nguồn; Điều phối tự trả lời câu xã giao | nhanh | xong |
| 4 | `demo-ai-fix.ts`: bật gói knowledge cho demo (cấp theo Group đang có quyền contracts), tài liệu giả QC-TC-01, báo agent seed cũ | nhanh | xong |
| 5 | Test: unit `model-tiers.test.ts`, `seed.test.ts`, `demo-ai-fix.test.ts`; int `knowledge.chat-tool.int.test.ts`; e2e (không chạy) `e2e/deployed/05-ai-tiers-rag.deployed.ts` | nhanh | xong |

## Quyết định trong lúc làm
- Dự phòng profile (HUB-FR-31) xét lúc GIAO job theo `provider_state` của PROVIDER, không theo model ⇒ bước cùng `claude-sub`
  khác model không bao giờ dự phòng được. Mỗi model một "làn" provider (`claude-sub` = sonnet, `claude-sub-haiku`, `claude-sub-opus`).
  Runtime nhận mọi khoá `claude-sub-<làn>` (ClaudeProvider) và tự thêm 2 làn mặc định khi `AGENT_RT_PROVIDERS` có `claude-sub`
  (không đổi env/compose). Hạn mức 5 giờ chung tài khoản: mỗi làn tự vào cooldown sau một job bị từ chối.
- Model = alias CLI `haiku`/`sonnet`/`opus` (CLI tự trỏ bản mới nhất; payload `--model` qua `ClaudeAgentOptions.model`).
- Trích hợp đồng (`contracts.extract`) không đi qua profile (AI client trực tiếp, `CONTRACTS_EXTRACT_MODEL`, mặc định opus) ⇒ giữ nguyên.
  Bậc deep: `fixbug-engineer`, `fixbug-reviewer` (chỉ khi `HUB_SEED_FIXTURES`).
- Tool tri thức đã có (N4, khoá `knowledge-search`); không viết tool mới — chỉ cấp qua `runtime_options.pack_tools`.
- `hub:seed` chạy mỗi lần deploy (setup.sh) và ghi đè agent theo yaml ⇒ đổi profile trong Studio mất khi deploy lại (nợ cũ, ghi lại).

## Còn lại
- e2e `05-ai-tiers-rag.deployed.ts` chạy một lần sau deploy (e2e-deployed.ps1 -Spec …); qc ghi lock file e2e mới.
- Python `test_main.py` (registry_providers) chưa chạy (runner evotest `--no-python`).
