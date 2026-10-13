# features/models (HUB-FR-66, HUB-FR-67)

Studio › Models. Route lazy `/models` (`?tab=providers|profiles`, `?drawer=new|<id>`, `?guide=<id>`).

| Phần | Trạng thái |
|---|---|
| Providers: bảng, Sheet thêm/sửa (SecretField = select secret `provider_api_key`), xoá + InUseDialog | T5 xong |
| CheckDialog (Kiểm tra key/lại) + RunbookSheet | T5b: gắn qua `onCheck`/`onGuide` của `ProvidersPanel` |
| Profiles (StepsEditor, LiveSummary) | T5c: thay `EmptyState` trong tab Profiles của `ModelsPage` |

Gọi API chỉ trong `api.ts`. FE không bao giờ hiện hay giữ giá trị key (chỉ `secret_id`). Bảng làm tươi 10 s.
