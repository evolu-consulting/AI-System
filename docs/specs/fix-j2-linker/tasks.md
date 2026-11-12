# fix-j2-linker — duyệt đơn tham gia kèm đối tác có sẵn bị 503 «Partner linking unavailable» (CR-130, e2e J2)


## Nguyên nhân
`community.mount.ts` `mountCommunity()` (đường của `packs.mount.ts` → `mountCommunityWired`) không khai/nhận `partners` trong tham số `o`: `communityPorts()` tiêm `partners: partnerLinker()` nhưng nó rơi vào `...sweep` (đi cho `startSweeper`) và không bao giờ tới `communityModule` ⇒ `FlowDeps.partners` undefined ⇒ `linkJoined` ném `PARTNER_LINK_UNAVAILABLE` 503. Int cũ gọi thẳng `communityModule(..., { partners })` nên không bắt được. Thêm: đường thẻ việc (flow-slot `act`) không map 503 ⇒ AppError «unhandled» trong log.

## Sửa
- `community/community.mount.ts`: `mountCommunity` nhận `partners` và chuyển cho `communityModule`.
- `community/adapters/flow-slots.ts` `outcomeOfError`: 503 ⇒ `{ error: { code, status: 503 } }` (có mã HTTP, không unhandled).
- Int mới `packs/community-wire.join-link.int.test.ts` qua `mountCommunityWired` thật (không tiêm tay): duyệt + `partyKey` ⇒ 200 approved + hồ sơ SHT gắn công ty đối tác; đỏ (503) khi bỏ sửa, xanh khi có.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp
Không thay đổi hành vi (lý do: sửa nối cổng PartnerLinker bị rơi ở wiring để đúng hành vi đã chốt «duyệt đơn kèm đối tác có sẵn»; 503 thẻ việc chỉ đổi từ lỗi chưa xử lý sang mã HTTP).
