# P-b-sources · câu chữ VI/EN nguyên văn (frontend)

Thuộc [`plan-frontend.md`](plan-frontend.md). Khoá nằm ở: `process.sources.*` (file `locales/process/sources.{vi,en}.json`, admin), `process.inputs.*` (file `inputs.{vi,en}.json`, chat), `process.admin.editor.{sources,inputs,mustKnow}.*` (phần `admin` có sẵn), `process.run.reason.source_unresolvable` (phần `run`), `nav.sources` (`locales.ts`). `{{x}}` = tham số. Câu lỗi server luôn là **câu tĩnh theo mã** dưới đây (không in `message` của server). `bun run i18n:check` phải xanh.

## 1. Nhãn, tiêu đề, trạng thái (`process.sources.*`)
| Khoá | VI | EN |
|---|---|---|
| `nav.sources` | Nguồn | Sources |
| `title` | Nguồn tham chiếu | Reference sources |
| `subtitle` | Kho Git công khai, đường dẫn trên máy Runtime hoặc tài liệu thư viện mà agent được đọc (chỉ đọc) khi chạy quy trình. | Public Git repositories, paths on the Runtime machine or library documents that agents may read (read-only) while running a process. |
| `add` | Thêm nguồn | Add source |
| `col.key` / `kind` / `desc` / `target` / `usedBy` / `status` | Ký hiệu / Loại / Mô tả / Đích / Dùng bởi / Trạng thái | Key / Type / Description / Target / Used by / Status |
| `table` (aria) | Nguồn | Sources |
| `filter.tenant` | Công ty | Company |
| `filter.kind` | Loại nguồn | Source type |
| `filter.kindAll` | Tất cả loại | All types |
| `filter.search` | Tìm theo ký hiệu | Search by key |
| `kind.git_remote` | Git công khai | Public Git |
| `kind.local_path` | Đường dẫn cục bộ | Local path |
| `kind.library` | Tài liệu thư viện | Library document |
| `target.hidden` | Ẩn (chỉ quản trị nền tảng) | Hidden (platform admin only) |
| `target.library` | Tài liệu thư viện | Library document |
| `usedBy.count` | {{count}} quy trình | {{count}} processes (`_one`: 1 process) |
| `status.unchecked` | Chưa kiểm tra | Not checked |
| `status.pinned` | Đã kiểm tra · {{pin}} | Checked · {{pin}} |
| `row.actions` (aria) | Thao tác {{key}} | Actions for {{key}} |
| `row.edit` / `view` / `check` / `delete` | Sửa / Xem / Kiểm tra kết nối / Xoá | Edit / View / Test connection / Delete |
| `row.checkForbidden` | Chỉ quản trị nền tảng kiểm tra được nguồn này. | Only platform administrators can test this source. |
| `loading` | Đang tải nguồn… | Loading sources… |
| `empty` | Chưa có nguồn nào. | No sources yet. |
| `loadError` | Không tải được danh sách nguồn. | Could not load sources. |
| `retry` | Thử lại | Retry |
| `more` | Tải thêm | Load more |
| `forbidden` | Bạn không có quyền xem trang này. | You do not have permission to view this page. |

## 2. Drawer, trường, validate
| Khoá | VI | EN |
|---|---|---|
| `drawer.new` | Thêm nguồn | Add source |
| `drawer.edit` | Sửa nguồn {{key}} | Edit source {{key}} |
| `drawer.view` | Xem nguồn {{key}} | View source {{key}} |
| `field.key` | Ký hiệu nguồn | Source key |
| `field.key.hint` | 2–32 ký tự: chữ thường, số, dấu gạch ngang. Không đổi được sau khi tạo. | 2–32 characters: lowercase letters, digits, hyphens. Cannot be changed after creation. |
| `field.kind` | Loại nguồn | Source type |
| `field.url` | Địa chỉ kho Git (https) | Git repository URL (https) |
| `field.branch` | Nhánh (branch) | Branch |
| `field.path` | Đường dẫn trên máy Runtime | Path on the Runtime machine |
| `field.document` | Tài liệu thư viện | Library document |
| `field.document.version` | Phiên bản hiện tại: {{version}} | Current version: {{version}} |
| `field.tenant` | Công ty | Company |
| `field.desc` | Mô tả | Description |
| `field.desc.hint` | Mô tả ngắn để agent biết nguồn này dùng cho việc gì. | A short note so the agent knows what this source is for. |
| `git.publicOnly` | Chỉ hỗ trợ kho công khai. Kho riêng chưa được hỗ trợ. | Public repositories only. Private repositories are not supported yet. |
| `local.warning` | Đường dẫn này nằm trên máy chạy Runtime, không phải máy của bạn. Phải nằm trong thư mục gốc đã được cấu hình. | This path is on the machine that runs the Runtime, not on your computer. It must be inside a configured root directory. |
| `view.localNote` | Nguồn đường dẫn cục bộ chỉ quản trị nền tảng được xem đường dẫn và chỉnh sửa. | Only platform administrators can see and edit the path of a local-path source. |
| `save` / `cancel` | Lưu / Huỷ | Save / Cancel |
| `check.saveFirst` | Lưu nguồn trước, rồi kiểm tra kết nối. | Save the source first, then test the connection. |
| `check.dirty` | Có thay đổi chưa lưu. Lưu trước khi kiểm tra. | You have unsaved changes. Save before testing. |
| `check.running` | Đang kiểm tra… | Testing… |
| `err.key.invalid` | Ký hiệu gồm 2–32 ký tự: chữ thường, số hoặc dấu gạch ngang. | The key must be 2–32 characters: lowercase letters, digits or hyphens. |
| `err.url.required` | Nhập địa chỉ kho Git. | Enter the Git repository URL. |
| `err.url.https` | Địa chỉ phải bắt đầu bằng https://. | The URL must start with https://. |
| `err.url.credential` | Không đưa tên người dùng hoặc mật khẩu vào địa chỉ. Chỉ dùng kho công khai. | Do not put a username or password in the URL. Use a public repository only. |
| `err.url.tooLong` | Địa chỉ tối đa 2048 ký tự. | The URL can be at most 2048 characters. |
| `err.branch.required` | Nhập tên nhánh. | Enter a branch name. |
| `err.branch.dash` | Tên nhánh không được bắt đầu bằng dấu “-”. | A branch name cannot start with “-”. |
| `err.branch.tooLong` | Tên nhánh tối đa 255 ký tự. | A branch name can be at most 255 characters. |
| `err.path.required` | Nhập đường dẫn. | Enter a path. |
| `err.path.tooLong` | Đường dẫn tối đa 1024 ký tự. | The path can be at most 1024 characters. |
| `err.document.required` | Chọn một tài liệu. | Select a document. |
| `err.tenant.required` | Chọn công ty. | Select a company. |
| `err.desc.tooLong` | Mô tả tối đa 500 ký tự. | The description can be at most 500 characters. |

## 3. Lỗi server, toast, hộp thoại
| Mã / tình huống | Chỗ hiện | VI | EN |
|---|---|---|---|
| `SOURCE_KEY_TAKEN` 409 | dưới ô ký hiệu | Ký hiệu “{{key}}” đã có trong công ty này. | The key “{{key}}” is already used in this company. |
| `SOURCE_HOST_NOT_ALLOWED` 422 | dưới ô địa chỉ / kết quả kiểm tra | Máy chủ này chưa được cho phép. Hiện chỉ hỗ trợ kho Git công khai trên các máy chủ quản trị viên đã cho phép. | This host is not allowed. Only public Git repositories on hosts your administrators have allowed are supported. |
| `SOURCE_FORBIDDEN_KIND` 403 | `alert` trong drawer / kết quả kiểm tra / toast xoá | Chỉ quản trị nền tảng mới được khai báo, sửa, xoá hoặc kiểm tra nguồn đường dẫn cục bộ. | Only platform administrators can create, edit, delete or test local-path sources. |
| `SOURCE_UNRESOLVABLE` 422 | kết quả kiểm tra / form `!key` | Không đọc được nguồn này. Kiểm tra địa chỉ, nhánh hoặc đường dẫn rồi thử lại. | Could not read this source. Check the URL, branch or path and try again. |
| `SOURCE_TOO_LARGE` 422 | kết quả kiểm tra | Nguồn quá lớn: tối đa 50 MB và 2.000 tệp sau khi lọc. Thu hẹp nguồn hoặc đường dẫn cho phép. | The source is too large: at most 50 MB and 2,000 files after filtering. Narrow the source or the allowed paths. |
| `SOURCE_NOT_FOUND` 404 | toast + đóng drawer | Nguồn không còn tồn tại. | This source no longer exists. |
| `SOURCE_IN_USE` 409 (xoá) | `BlockedDialog` | tiêu đề: Không thể xoá nguồn {{key}} · nội dung: Nguồn đang được các quy trình sau dùng. Gỡ nguồn khỏi các giai đoạn này trước khi xoá. | title: Cannot delete source {{key}} · body: This source is used by the processes below. Remove it from these stages before deleting. |
| `SOURCE_IN_USE` 409 (đổi kind) | `alert` | Không thể đổi loại nguồn đang được quy trình dùng. | You cannot change the type of a source that processes use. |
| `VERSION_CONFLICT` 409 | `ConflictDialog` chung | (câu chung của Admin) | (shared Admin text) |
| `VALIDATION_ERROR` 422 | theo ô (`details.issues`) | (câu lỗi ô ở §2) | (field messages in §2) |
| Hết thời gian / Runtime không phản hồi | kết quả kiểm tra | Không nhận được phản hồi từ Runtime. Thử lại sau. | No response from the Runtime. Try again later. |
| Mạng / 5xx | `alert` + toast | Không thực hiện được. Thử lại sau. | The action could not be completed. Try again later. |
| Kiểm tra OK — git | `status` | Kết nối được: {{branch}} → {{sha}} · {{files}} tệp · {{size}} | Connected: {{branch}} → {{sha}} · {{files}} files · {{size}} |
| Kiểm tra OK — library | `status` | Tài liệu đọc được · phiên bản {{version}} · {{size}} | Document is readable · version {{version}} · {{size}} |
| Kiểm tra OK — local | `status` | Đường dẫn hợp lệ · {{files}} tệp · {{size}} | Path is valid · {{files}} files · {{size}} |
| Toast tạo | toast | Đã tạo nguồn {{key}} | Source {{key}} created |
| Toast lưu | toast | Đã lưu nguồn {{key}} | Source {{key}} saved |
| Toast xoá | toast | Đã xoá nguồn {{key}} | Source {{key}} deleted |
| Xác nhận xoá | `AlertDialog` | tiêu đề: Xoá nguồn {{key}}? · nội dung: Quy trình không còn dùng nguồn này. Các lượt chạy đang dùng bản ghim vẫn giữ nguyên. · nút: Xoá / Huỷ | title: Delete source {{key}}? · body: Processes no longer use this source. Runs already using a pinned version are not affected. · buttons: Delete / Cancel |

## 4. Editor quy trình (`process.admin.editor.*`)
| Khoá | VI | EN |
|---|---|---|
| `sources.title` | Nguồn của quy trình | Process sources |
| `sources.add` | Thêm nguồn | Add source |
| `sources.remove` | Bỏ nguồn {{key}} | Remove source {{key}} |
| `sources.empty` | Quy trình chưa dùng nguồn nào. | This process uses no sources yet. |
| `sources.declare` | Khai báo nguồn | Declare a source |
| `sources.max` | Tối đa 20 nguồn cho một quy trình. | A process can have at most 20 sources. |
| `sources.gone` | Nguồn không còn tồn tại. Bỏ nguồn này trước khi lưu. | This source no longer exists. Remove it before saving. |
| `sources.inUse` | Nguồn {{key}} đang được giai đoạn {{n}} dùng. Bỏ khỏi giai đoạn trước. | Source {{key}} is used by stage {{n}}. Remove it from the stage first. |
| `stage.sources` | Nguồn của giai đoạn | Stage sources |
| `stage.allowlist` | Đường dẫn cho phép — {{key}} | Allowed paths — {{key}} |
| `stage.allowlist.hint` | Mỗi dòng một mẫu (vd. docs/**/*.md). Để trống = cả nguồn, vẫn tính trần 50 MB / 2.000 tệp. | One pattern per line (e.g. docs/**/*.md). Empty = the whole source; the 50 MB / 2,000 file limit still applies. |
| `stage.sources.max` | Tối đa 5 nguồn mỗi giai đoạn. | At most 5 sources per stage. |
| `stage.sources.notInDef` | Giai đoạn {{n}} dùng nguồn chưa nằm trong danh sách nguồn của quy trình. | Stage {{n}} uses a source that is not in the process source list. |
| `stage.sources.autoOutput` | Giai đoạn này sẽ bắt buộc có mục “## Nguồn tham chiếu” trong kết quả (tự thêm). | This stage will require a “## Nguồn tham chiếu” section in its output (added automatically). |
| `stage.sources.budget` | Ngân sách mặc định 200.000 token nếu giai đoạn không đặt. | Default budget is 200,000 tokens if the stage sets none. |
| `err.glob.invalid` | Mẫu đường dẫn không hợp lệ: không dùng “..”, không bắt đầu bằng “/”, tối đa 256 ký tự. | Invalid path pattern: no “..”, no leading “/”, at most 256 characters. |
| `err.glob.max` | Tối đa 20 mẫu cho mỗi nguồn. | At most 20 patterns per source. |
| `inputs.title` | Thông tin đầu vào | Process inputs |
| `inputs.note` | Thiếu trường bắt buộc, agent sẽ hỏi lại người chạy. | If a required field is missing, the agent will ask the person running the process. |
| `inputs.add` | Thêm trường | Add field |
| `inputs.remove` | Xoá trường {{key}} | Remove field {{key}} |
| `inputs.key` | Ký hiệu trường | Field key |
| `inputs.label` | Nhãn hiển thị | Display label |
| `inputs.type` | Kiểu trường | Field type |
| `inputs.type.text` / `select` / `file` / `source_ref` | Chữ / Chọn / Tệp / Nguồn + nhánh | Text / Choice / File / Source + branch |
| `inputs.required` | Bắt buộc | Required |
| `inputs.options` | Lựa chọn (mỗi dòng một giá trị) | Options (one per line) |
| `inputs.empty` | Chưa có trường đầu vào. | No input fields yet. |
| `err.input.key` | Ký hiệu trường gồm 2–32 ký tự: chữ thường, số hoặc dấu gạch ngang. | The field key must be 2–32 characters: lowercase letters, digits or hyphens. |
| `err.input.keyDup` | Ký hiệu trường bị trùng. | This field key is already used. |
| `err.input.label` | Nhập nhãn hiển thị (tối đa 80 ký tự). | Enter a display label (at most 80 characters). |
| `err.input.options` | Kiểu Chọn cần 1–20 lựa chọn, mỗi lựa chọn tối đa 200 ký tự, không trùng. | A Choice field needs 1–20 options, each at most 200 characters, with no duplicates. |
| `err.input.max` | Tối đa 10 trường đầu vào. | At most 10 input fields. |
| `mustKnow.label` | Điều phải biết trước khi làm | Must know before starting |
| `mustKnow.hint` | Mỗi dòng một mục. Agent sẽ hỏi những điều chưa biết (tối đa 3 lần hỏi mỗi giai đoạn). | One item per line. The agent asks about what it does not know yet (at most 3 questions per stage). |
| `err.mustKnow.max` | Tối đa 10 mục. | At most 10 items. |
| `err.mustKnow.tooLong` | Mỗi mục tối đa 200 ký tự. | Each item can be at most 200 characters. |
| `PROCESS_REF_INVALID` (nguồn) | Giai đoạn {{n}} dùng nguồn chưa nằm trong danh sách nguồn của quy trình. | (như `stage.sources.notInDef`) |

## 5. Chat — form `!key` (`process.inputs.*`), chip, lý do
| Khoá | VI | EN |
|---|---|---|
| `form.title` | Thông tin cho quy trình {{name}} | Details for process {{name}} |
| `form.hint` | Điền những gì bạn đã biết. Thiếu gì, agent sẽ hỏi lại. | Fill in what you know. The agent will ask about anything missing. |
| `form.start` / `cancel` | Bắt đầu quy trình / Huỷ | Start process / Cancel |
| `form.required` | Nên điền | Recommended |
| `field.file.pick` | Chọn tệp — {{label}} | Choose file — {{label}} |
| `field.file.remove` | Bỏ tệp | Remove file |
| `field.file.uploading` | Đang tải tệp… | Uploading file… |
| `field.file.error` | Không tải được tệp. Thử lại hoặc chọn tệp khác. | Could not upload the file. Try again or choose another file. |
| `field.source` | {{label}} · Nguồn | {{label}} · Source |
| `field.source.placeholder` | Chọn nguồn | Choose a source |
| `field.branch` | {{label}} · Nhánh (branch) | {{label}} · Branch |
| `field.branch.placeholder` | main | main |
| `field.select.placeholder` | Chọn một giá trị | Choose a value |
| `sources.loading` | Đang tải nguồn… | Loading sources… |
| `sources.empty` | Công ty chưa khai báo nguồn Git nào. | Your company has not declared any Git source yet. |
| `sources.error` | Không tải được danh sách nguồn. | Could not load sources. |
| `err.text.tooLong` | Nội dung quá dài. | The text is too long. |
| `err.branch.required` | Nhập tên nhánh cho nguồn đã chọn. | Enter a branch for the selected source. |
| `err.branch.dash` | Tên nhánh không được bắt đầu bằng dấu “-”. | A branch name cannot start with “-”. |
| `err.branch.tooLong` | Tên nhánh tối đa 255 ký tự. | A branch name can be at most 255 characters. |
| `err.sourceUnresolvable` | Không bắt đầu được: không đọc được một nguồn của quy trình. Báo quản trị viên công ty kiểm tra nguồn. | Could not start: a source of this process cannot be read. Ask your company administrator to check the sources. |
| `err.sourceInvalid` | Nguồn hoặc nhánh đã chọn không hợp lệ. | The selected source or branch is not valid. |
| `err.generic` | Không bắt đầu được quy trình. Thử lại sau. | Could not start the process. Try again later. |
| `ask.chip.title` | {{key}} — {{description}} | {{key}} — {{description}} |
| `run.reason.source_unresolvable` | Không đọc được nguồn tham chiếu | Reference source could not be read |
| `run.reason.source_unresolvable.hint` | Một nguồn (kho Git, đường dẫn hoặc tài liệu) không đọc được lúc bắt đầu. Nhờ quản trị viên kiểm tra nguồn, rồi chọn cách xử lý. | A source (Git repository, path or document) could not be read at start. Ask an administrator to check it, then choose how to proceed. |
