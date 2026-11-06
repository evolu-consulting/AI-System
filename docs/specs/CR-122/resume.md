# CR-122 — điểm dừng (2026-11-06 tối, người dùng đổi tài khoản lần 2)

gd0 đã đẩy: d2945cd3c. Luật brief agent: `docs/specs/CR-122/agent-rules.txt` (+ CLAUDE.md Luật 0d.8). Launcher chụp UI: `tools/hub-dev/src/uat-stack.ts`. Ảnh: `docs/specs/CR-122/shots/` (chưa commit, u2d-*/u2e-*/u2f-* là bản mới nhất).

## Đã gộp vào gd0
F0 · E1 · E1b (+B1 cặp gốc/bản sao) · E2 · E2b · E3 · E3b · E4 · E4b · A1 · A2 · A2b (helper → `@ai/db/pack-scope`) · N1 (0110, node module FR-25) · N2 (kiểm nối + AI cầu nối FR-26) · M1 (0111 backfill + bóng savepoint) · U1 · U2 · U2b · U2c · U2d · U2e · U2f (UI ĐÓNG BĂNG) · E5 · E5b (pack 0078) · E5c (pack 0079) · E5d (pack 0080, sửa 2 Blocker huỷ phong bì). Opus low đã soát: E1, E2, E2b, A2, E1b+E3, M1, E5–E5c (Blocker đã sửa).

## Đang dở
**Q1 e2e** — nhánh `slice/cr122-q1-e2e`, worktree `F:\workspace\evolu-wt\cr122-q1-e2e`, 4 commit, sạch (agent bị dừng khi đang chờ lượt evotest 3). Có e2e G1/G2/G3 + ca UI trình sửa + ca Ký số (fixme tới khi stack có nhà cung cấp ký). Việc còn: chạy job journey-approval, community-web, P-a, fnr-showcase, P-b2 ⇒ test:lock:write ⇒ một lượt `verify:wave --json` ⇒ gộp.

**LỖI SẢN PHẨM #1 (qc tìm, CHƯA sửa — chặn G1/G2 thật):** không xuất bản được flow Thư viện có trigger. `library.service.ts:77-89` (`specOrThrow(def.slot)` + systemTools `contracts-route/finalize` ở `approval.mount.ts:107`) và `library.repo.ts:19` (`IS_LIB` đòi `slot is not null`). Flow trigger không khe ⇒ 404; có khe ⇒ PROCESS_PUBLISH_INVALID. Tái hiện: POST /process-defs {trigger, app} rồi POST /process-defs/:id/publish. Giao agent engine (lát E6): IS_LIB = `slot IS NOT NULL OR trigger IS NOT NULL`, nhánh publish theo trigger không đòi slot/systemTools, int test; sau đó Q1 bỏ phần dựng flow bằng SQL trong `e2e/_kit/flows.ts`.

## Hàng chờ nhỏ (không chặn)
Huỷ phong bì lỗi 4xx vĩnh viễn chưa nhả quyền sớm (chờ lease 10') · chuông nhắc/quá hạn node Ký số chưa có i18n riêng · danh sách người ký chỉ 50 đầu, chưa ô tìm · canvas chưa tự fit tới node lỗi, hover cạnh vàng · ô gợi ý AI chạy thật trên flow mẫu trả "không có trường cùng kiểu" (kiểm lại prompt khi có dữ liệu thật) · seed lại agent `flow-bridge` khi deploy.

## Sau đó
Deploy sohoptac2 (CHỜ người dùng xác nhận; migration hub 0105/0106/0109/0110/0111 + pack contracts 0077–0080 + community 0010; đọc NOTICE của 0111; seed lại agents) → bật cờ Demo → `flow:shadow-diff` = 0 → Q1 G1–G3 trên prod Demo (người dùng đăng nhập) → NiTi → R1 gỡ cũ (0108, người dùng xác nhận; nợ R1 liệt kê trong tasks của u2b/u2c/u2e: use-company-flows, flow-rows, JobRow, api-routing, routing-current, chữ "khe" trong tenants.flows/slots, slotFlowOf, withConfirmStep, approval-slot*, routing-def, app-slots).

Cách nối lại: agent mới trỏ vào worktree/nhánh, đọc tasks.md của lát; gộp: `git reset -q; bun run slice:merge <lát> --no-test`, `test:lock:verify`, push github, `slice:rm`.
