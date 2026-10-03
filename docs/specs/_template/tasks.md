# Tasks · <ID>

Mỗi task: một commit `[FR]`, diff ≈ ≤ 400 dòng. Tick khi lệnh "xong" xanh. `blocked` kèm lý do → báo cáo cuối.
Cột `Rủi ro` (`cao` / `thường`) quyết định model khi BUILD — định nghĩa trong `docs/WORKFLOW.md` mục "Chính sách model".

| # | Task | Agent | Rủi ro | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|
| T1 | … | backend-lead | cao / thường | `apps/admin-api/src/modules/...` | — | `bun test apps/admin-api/src/modules/...` | [ ] |
