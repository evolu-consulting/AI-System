# Workflow — quy trình AI-SDLC của dự án

Mỗi mốc (milestone) chạy đúng một vòng dưới đây. Người dùng chỉ duyệt **một lần mỗi mốc** (Gate). Sau Gate, đội agent làm hết, không hỏi lại (xem Luật 2 trong `CLAUDE.md`).

## Đội agent (`.claude/agents/`)

| Agent | Sở hữu | Được sửa | Không được sửa |
|---|---|---|---|
| `docs-architect` | Cấu trúc repo & docs, INDEX, CODEMAP, TRACE, STATE, ROADMAP, tách BA thành spec | `docs/**` (trừ `docs/design/**` chỉ sửa khi được giao), `CLAUDE.md`, README module | Code, test |
| `intake-analyst` | Đối chiếu thông tin mới với spec/design (Luật 0), phân loại + ảnh hưởng + câu hỏi | — (chỉ đọc) | — |
| `spec-readiness` | Cửa READY / NOT READY | — (chỉ đọc) | — |
| `backend-lead` | Contract, DB, RLS, migration, hiệu năng server, ADR backend, code backend | `apps/*-api/**`, `packages/contracts/**`, `packages/db/**`, `docs/specs/*/plan.md` phần backend, `docs/adr/**` | `tests/acceptance/**`, `e2e/**`, `apps/*-web/**` |
| `frontend-lead` | Lấp chỗ trống UI/UX (trạng thái, câu chữ VI/EN, màn thiếu), hiệu năng web, ADR frontend, code frontend | `apps/*-web/**`, `packages/ui/**`, `packages/i18n/**`, phần frontend của `plan.md`, `docs/adr/**` | `packages/contracts/**` (đề xuất qua backend-lead), `tests/acceptance/**`, `e2e/**` |
| `qc` | Test plan theo FR/AC, acceptance + e2e, test luật BR, fixture/seed test, báo cáo độ phủ | `tests/**`, `e2e/**`, `docs/specs/*/test-plan.md`, `tests/.lock` | Code sản phẩm |
| `reviewer` | Review theo rubric (đúng spec, bảo mật, dữ liệu, hiệu năng, test, chuẩn, FE, truy vết) | — (chỉ đọc) | — |

### Chính sách model (tối ưu token)

Mặc định ghi ở dòng `model:` của từng file agent. Điều phối **nâng lên Opus** (tham số `model` khi gọi) chỉ trong các trường hợp ghi ở cột cuối.

| Agent | Mặc định | Lý do | Nâng lên Opus khi |
|---|---|---|---|
| `spec-readiness` | Opus | Suy luận sâu, bắt mâu thuẫn | — |
| `backend-lead` | Opus | Contract, dữ liệu, bảo mật tenant | — |
| `reviewer` | Opus | Bảo mật, đúng nghiệp vụ | — |
| `intake-analyst` | Opus | Chỉ chạy ở mức Đầy đủ (tài liệu lớn) | — (mức Nhanh do điều phối tự làm) |
| `frontend-lead` | Sonnet | BUILD theo spec đã chi tiết | Chế độ PLAN có màn mới / lấp chỗ trống UX lớn |
| `qc` | Sonnet | Viết test theo spec + template | Phân xử Tranh chấp test; luật BR phức tạp (quyền, quota) |
| `docs-architect` | Sonnet | Việc cấu trúc, đồng bộ | — |

Phiên chính (Claude) là **điều phối**: gọi agent theo thứ tự, gom kết quả, giữ `tasks.md` và `docs/STATE.md`, trình Gate cho người dùng.

## Thông tin mới giữa chừng

Mọi yêu cầu/thay đổi mới (đầu phiên hay giữa phiên) đi qua **Intake** trước (Luật 0 trong `CLAUDE.md`, skill `/intake`): hỏi người dùng → intake-analyst → người dùng chốt → docs-architect cập nhật + `CHANGE-REQUESTS.md` → spec-readiness. Spec đã qua Gate bị ảnh hưởng → Gate lại.

## Vòng một mốc

```
1. docs-architect   tách BA/UI thành docs/specs/<ID>/ (spec.md từ template) cho mốc
2. song song:
   backend-lead     contract (zod) + DB + ngân sách hiệu năng + ADR nếu cần    → plan.md (BE)
   frontend-lead    lấp chỗ trống UI, câu chữ, role/nhãn cho e2e + ADR nếu cần   → plan.md (FE)
3. qc               test-plan.md + viết acceptance/e2e/test luật BR dựa trên contract + spec (đỏ là đúng)
4. spec-readiness   READY? — không: điều phối gom câu hỏi hỏi người dùng MỘT lượt, quay lại 1–3
5. ★ GATE           người dùng duyệt gói: spec · contract · UI · ADR · test-plan · tasks
6. qc               ghi tests/.lock (checksum test đã duyệt)
7. song song, mỗi agent một git worktree:
   backend-lead ∥ frontend-lead   code theo tasks.md tới khi test của QC xanh + unit test của mình
8. qc               chạy toàn bộ, báo độ phủ theo FR; test sai → mục Tranh chấp
9. reviewer         review; Blocker/Major → trả agent code sửa (tối đa 2 vòng/task)
10. docs-architect  cập nhật CODEMAP, TRACE, STATE, README module → báo cáo cuối cho người dùng
```

## Luật khoá test

- Sau Gate, `tests/acceptance/**` và `e2e/**` bị khoá bằng `tests/.lock` (sha256 từng file). Chỉ `qc` được cập nhật lock.
- `bun run test:lock:verify` chạy trong CI và trước khi báo xong; checksum lệch → đỏ.
- backend-lead / frontend-lead **không bao giờ** sửa, xoá, `skip` test bị khoá để cho xanh.

## Tranh chấp test

Agent code tin một test sai → **không sửa test**, ghi vào mục "Tranh chấp test" của `spec.md`: test nào, vì sao sai, trích BA. `qc` quyết dựa trên BA:
- Test sai → qc sửa test + lock, ghi lý do.
- Test đúng → agent code sửa code.
- BA mơ hồ → hard stop, gom vào báo cáo cuối.

## Gói duyệt (Gate)

Một file `docs/specs/<milestone>-gate.md` do điều phối tạo, gồm: danh sách spec + link · contract thay đổi · UI mới / artboard mới · ADR mới (Proposed) · test-plan tóm tắt (số test theo FR) · rủi ro · câu hỏi đã được trả lời. Người dùng trả lời "duyệt" hoặc sửa từng dòng. Duyệt xong: ADR chuyển Accepted, spec chuyển `approved`.

## Đề xuất công nghệ

- Stack nền đã chốt trong `docs/adr/0001-stack.md`. Agent chỉ đề xuất khi cần thêm thư viện hoặc đổi cách làm.
- Mỗi đề xuất = 1 ADR (`docs/adr/NNNN-<slug>.md`, trạng thái Proposed) có: bối cảnh, lựa chọn so sánh, số đo hiệu năng/chi phí liên quan, quyết định đề xuất. Duyệt cùng Gate, không hỏi riêng.
- "Tối ưu" phải là con số trong spec (ngân sách mặc định: `CONVENTIONS.md` §6).
