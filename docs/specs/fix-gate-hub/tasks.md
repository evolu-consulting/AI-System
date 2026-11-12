---
id: fix-gate-hub
lát: fix-gate-hub (gate cuối đợt CR-132: check-contract-name + check:size)
cr: CR-132
làn: nhanh
migration: không
phụ thuộc:
---
## Làm
- `tools/scripts/src/check-contract-name.ts`: ALLOWLIST `messages/adapters/messages.repo.ts` (max 3) — `c.title` ở đó là TÊN NHÓM chat của `msg_conversations`, không phải `contracts.title` của HĐ.
- `packs.mount.ts` 400 dòng sát trần ⇒ tách nối tệp (CR-133 «Tài liệu kèm» + CR-132 tin nhắn) sang `packs.contracts-attachments.ts` (`mountContractAttachments`), còn 391 dòng; `recordRunFiles` của hub vẫn tiêm ở lớp packs (không vào gói).

## Test
check-contract-name test (5 pass) · `check:size` xanh · tsc hub-api sạch · depcruise 0 MỚI.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp
Không thay đổi hành vi (lý do: sửa gate + tách file nối module)
