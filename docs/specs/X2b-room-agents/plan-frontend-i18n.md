# X2b · Phụ lục plan-frontend: câu chữ i18n VI/EN

Key trong `packages/i18n/locales/chat/{vi,en}.json`. Nhóm mới `roomAgent`; thêm 1 key `menu`; **dùng lại** (không đổi): `sendError.*` (agentNotFound, tooManyRuns, tagOnly, didYouMean, attachmentNotFound), `menu.agents*`, `flow.*`, `composer.stop`, `composer.flowPlaceholder`, `run.cancelled`, `run.rerun`, `attach.*`, `rooms.composer.group/dm` (nhãn textbox, e2e X2a).

## 1. Composer + menu `@`
| Key | VI | EN |
|---|---|---|
| `roomAgent.placeholder.group` | Nhắn cho nhóm… gõ @ để hỏi agent | Message the group… type @ to ask an agent |
| `roomAgent.placeholder.dm` | Nhắn cho {{name}}… gõ @ để hỏi agent | Message {{name}}… type @ to ask an agent |
| `roomAgent.hint` | Agent chỉ trả lời khi được @ — chạy bằng quyền và quota của người hỏi. | Agents reply only when @-mentioned — they run with the asker's permissions and quota. |
| `menu.agentsYours` | Agent bạn dùng được | Agents you can use |

## 2. Khối agent trong timeline
| Key | VI | EN |
|---|---|---|
| `roomAgent.block` | Trả lời của agent {{name}} | Reply from agent {{name}} |
| `roomAgent.blockWaiting` | Agent {{name}} đang chờ xác nhận | Agent {{name}} is waiting for confirmation |
| `roomAgent.askedBy` | {{name}} hỏi | Asked by {{name}} |
| `roomAgent.askedByMe` | Bạn hỏi | You asked |
| `roomAgent.runsAs` | Chạy bằng quyền của {{name}} | Runs with {{name}}'s permissions |
| `roomAgent.runsAsMe` | Chạy bằng quyền của bạn | Runs with your permissions |
| `roomAgent.working` | {{agent}} đang xử lý… | {{agent}} is working… |
| `roomAgent.onlyCallerStop` | Chỉ {{name}} dừng được | Only {{name}} can stop this |
| `roomAgent.waitConfirm` | Đang chờ {{name}} xác nhận — chỉ người hỏi mới bấm được. | Waiting for {{name}} to confirm — only the asker can respond. |
| `roomAgent.waitInput` | Đang chờ {{name}} trả lời agent. | Waiting for {{name}} to answer the agent. |
| `roomAgent.askTitle` | {{agent}} cần thêm thông tin | {{agent}} needs more information |
| `roomAgent.confirmTitle` | {{agent}} cần bạn xác nhận trước khi thực hiện | {{agent}} needs your confirmation before acting |
| `roomAgent.failed` | Agent không trả lời được. Thử hỏi lại sau. | The agent couldn't respond. Try asking again later. |
| `roomAgent.cancelledNoPerm` | Đã huỷ vì bạn không còn quyền dùng agent này. | Cancelled because you no longer have access to this agent. |
| `roomAgent.cancelledOther` | Đã huỷ | Cancelled |
| `roomAgent.steps` | {{count}} bước · {{seconds}}s | {{count}} steps · {{seconds}}s |
| `roomAgent.viewFlow` | Xem flow | View flow |
| `roomAgent.toast.notCaller` | Chỉ người hỏi mới trả lời được. | Only the asker can respond. |
| `roomAgent.toast.stopFailed` | Không dừng được. Thử lại sau. | Couldn't stop. Try again later. |

Trình đọc màn hình: `roomAgent.working` trong `role="status"` (đọc một lần khi bắt đầu); kết quả xong vào `role="log"` của timeline X2a.

## 3. Khung flow phòng
| Key | VI | EN |
|---|---|---|
| `roomAgent.flowReadonly` | Chỉ {{name}} tiếp tục được flow này. Muốn hỏi riêng, gõ @agent ở khung chat chính. | Only {{name}} can continue this flow. To ask yourself, type @agent in the main chat. |
| `roomAgent.flowLoadError` | Không tải được flow | Couldn't load this flow |
| `roomAgent.flowRetry` | Thử lại | Retry |

Header khung, đếm tin, ✕/Thu nhỏ, kéo đóng, "Trả lời trong flow…", "Tin nhắn trong flow": dùng lại `flow.*`, `composer.flow*` của C1.
