---
id: cr189-admin-org-api
lát: cr189-admin-org-api
cr: CR-189
làn: đầy đủ
migration: hub 0172 (số do điều phối giao)
phụ thuộc: cr189-org-members-tab
---
## Plan (ngắn)
API quản trị cho sửa cơ cấu trực tiếp trên sơ đồ (BR-189-6, chưa làm UI): tạo phòng con một lời gọi, đổi tên, đổi trưởng phòng, chuyển phòng cha, thêm/bớt thành viên (mỗi người một phòng, ở service), xoá phòng chỉ khi rỗng. Mỗi thao tác một giao dịch, khoá theo thứ tự cố định. Chỉ quản trị.

## Làm
- [x] `packages/contracts/src/org.ts`: schema + khối mã lỗi riêng `ORG_DEPT_ERRORS` (`DEPT_NOT_EMPTY`, `MEMBER_IS_HEAD`, cùng 409) + `lib/errors.ts` `orgDeptError`.
- [x] `org.shared.ts` (mới): `OrgCall`, `tenantOf`, `lockOrgTree` (thứ tự khoá), `assertNameFree`, `groupKeyOf`.
- [x] `org-dept.service.ts` (mới): `createDept`, `renameDept`, `deleteDept`. `org-dept.members.ts` (mới): `addDeptMembers`, `removeDeptMember` (+ `access {gained, lost}`).
- [x] `org.service.ts` `setDepartment`: khoá công ty ĐẦU TIÊN (trước khoá hàng group — cùng thứ tự với các thao tác mới), bỏ nhánh `remove`, đổi phòng cha kiểm tên trùng cùng cấp.
- [x] `org.routes.ts`: `POST /admin/org/departments`, `PUT …/:id/name`, `POST …/:id/members`, `DELETE …/:id/members/:userId`; `DELETE …/:id` đổi nghĩa (chặn khi còn người/phòng con).
- [x] (soát Opus) hub `0172` hàm DEFINER `hub.org_group_refs` + `org.hub.ts`: xoá phòng giữ Group nếu còn agent/quy trình/việc duyệt, chặn khi việc duyệt đang mở (`DEPT_IN_USE`); `access` tính cả agent + quy trình; `exists` có `tenant_id`; `groupKeyOf` trần 1000 lần; ca N2.
- [x] test int service + HTTP; sửa 2 test cũ có gọi `setDepartment(..., "remove")`.

## Không làm / Chạm
Không UI (lát #5), không trigger DB cho «mỗi người một phòng» (Q5), không tự sửa người đang ở nhiều phòng.
Chạm: `apps/admin-api/src/modules/org/*`, `apps/admin-api/src/lib/errors.ts`, `packages/contracts/src/org.ts`.

## Test tối thiểu
- int (evotest): `org-dept.service.int.test.ts`, `org-dept.routes.int.test.ts`, `org.service.int.test.ts`, `external-deny.int.test.ts`.

## Quyết định trong lúc làm
- **Quyền theo nhóm (`feature_grants`)**: Group phòng ban VẪN mang quyền ⇒ chuyển người giữa phòng CÓ THỂ đổi quyền của họ (cộng/trừ quyền của nhóm cũ/mới; quyền còn từ nhóm khác hoặc cấp trực tiếp cho người thì không mất). Quyết định: không chặn (nghiệp vụ muốn chuyển phòng), nhưng MỖI lời gọi chuyển/bỏ trả `access {gained, lost}` (số cặp người×tính năng, tính trước khi ghi, một câu SQL tập hợp) để UI báo «đổi quyền». Quyền cấp trực tiếp cho người không bị đụng. `access` tính cả `hub.agent_grants` và `process_defs.run_group_ids` (cùng câu tập hợp).
- «Mỗi người một phòng» ở service: thêm vào X ⇒ rời MỌI phòng ban khác (kể cả người vốn ở nhiều phòng); chỉ đụng `group_members` của Group có hàng `departments` (Group vai/beta/tuỳ ý giữ nguyên). Bỏ khỏi X ⇒ về phòng cha, phòng cấp trên cùng ⇒ về công ty; người vẫn ở phòng ban khác ⇒ không kéo thêm về cha.
- Trưởng phòng: của phòng KHÁC ⇒ không thêm/chuyển được (409 `MEMBER_IS_HEAD` `{user_ids, group_ids}`); trưởng phòng của CHÍNH phòng ⇒ không bỏ được (409, đổi trưởng phòng trước). Đang là trưởng phòng đích thì thêm vào là ok.
- Thứ tự khoá (một chỗ: `org.shared.ts`): advisory `org-dept:<tenant>` → groups theo id tăng (phòng đích + cha) → `group_members` theo (group, user) tăng → `config_meta`. `setDepartment` cũ khoá group TRƯỚC advisory ⇒ đảo lại để không deadlock với thao tác mới.
- «Phòng gốc không xoá» = nút «Công ty» ảo của sơ đồ (không có bản ghi) ⇒ không có API xoá nó; phòng cấp trên cùng (cha null) vẫn xoá được nếu rỗng.
- Xoá phòng rỗng: xoá cả Group, TRỪ khi Group còn được dùng: `feature_grants`/vai (cùng công ty), `hub.agent_grants`, `run_group_ids`, từng được giao việc duyệt (đã đóng) ⇒ chỉ bỏ hàng phòng ban, trả `{group_deleted:false}`. Việc duyệt ĐANG MỞ giao cho nhóm ⇒ 409 `DEPT_IN_USE {open_reviews}`. Đếm «còn người» = thành viên ∪ trưởng phòng.
- Fail-closed (soát vòng 2): có bảng Hub mà hàm `hub.org_group_refs` không gọi được ⇒ xoá phòng ném `INTERNAL_ERROR` `{reason:"hub_refs_unavailable"}`, KHÔNG xoá Group; DB không có Hub ⇒ không có tham chiếu. Tính `access` chỉ báo nên khi hàm không gọi được thì bỏ phần Hub, không chặn chuyển người.
- Hàm `org_group_refs` trả cả `item_id` (id agent/quy trình/việc duyệt) — chấp nhận: `accessDelta` cần phân biệt từng mục để không đếm trùng; chỉ id, chỉ đúng công ty của quản trị.
- Hub: `admin_rw` không đọc `process_defs`/`review_tasks` ⇒ migration hub `0172_cr189_org_group_refs` (DEFINER, chỉ quản trị đúng công ty, nhóm ≤ 1000; vắng hàm ⇒ coi như không có tham chiếu). Số 0172 do điều phối giao (sổ `docs/specs/CR-187/migrations.md`).
- Không thêm mã vào `API_ERRORS` (khoá 46): dùng `NAME_TAKEN` (tên trùng) có sẵn + khối mã riêng `ORG_DEPT_ERRORS` như `EXTERNAL_ORG_ERRORS`.
- Tên phòng: trim, gộp khoảng trắng, ≤ 64; trùng không phân hoa/thường trong cùng phòng cha ⇒ 409 `NAME_TAKEN` (kiểm trong khoá công ty ⇒ không đua). Phòng cũ đã trùng tên sẵn không bị chặn trừ khi đổi tên/đổi cha.
- Key Group tự sinh từ tên (bỏ dấu, thường, `-`, ≤ 24 ký tự + hậu tố `-2`…); không phụ thuộc người dùng nhập.
- Hoàn tác 6 giây = thao tác ngược: đổi tên trả `before`; chuyển trả `moved[].from_group_ids`; bỏ trả `moved_to_group_id`.
- `DELETE …/:id` giữ đường dẫn cũ nhưng ĐỔI NGHĨA theo spec (trước: gỡ đánh dấu, con lên cha). UI cũ `DeptCard` (admin-web) sẽ nhận 409 khi phòng còn người — lát #5 thay UI.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED docs/current/admin/to-chuc-sua-so-do.md
#### Yêu cầu: Tạo phòng con trong một lời gọi, tên không trùng cùng cấp
Quản trị tạo phòng (kèm phòng cha, trưởng phòng tuỳ chọn) trong một thao tác; tên không trùng (không phân hoa/thường) trong cùng phòng cha; đổi tên theo cùng luật.
- Kịch bản: khi quản trị tạo phòng con thì Group + phòng ban + trưởng phòng ghi cùng lúc, tên trùng cùng cấp bị 409 và lỗi không để lại gì [test: apps/admin-api/src/modules/org/org-dept.service.int.test.ts » một lời gọi tạo Group + phòng ban + trưởng phòng, phòng con, key không dấu, không trùng]
- Kịch bản: khi tên trùng cùng cấp thì 409 NAME_TAKEN, khác cấp thì được [test: apps/admin-api/src/modules/org/org-dept.service.int.test.ts » tên trùng cùng cấp (không phân hoa/thường) ⇒ 409 NAME_TAKEN, khác cấp thì được]
- Kịch bản: khi cha, trưởng phòng sai thì lỗi và không ghi gì [test: apps/admin-api/src/modules/org/org-dept.service.int.test.ts » cha không phải phòng ban / công ty khác ⇒ NOT_FOUND, trưởng phòng ngoài công ty ⇒ NOT_FOUND, đối tác ⇒ 422, không ghi gì (nguyên tử)]
- Kịch bản: khi quản trị khác người tạo đổi tên thì trả tên cũ, trùng cùng cấp bị chặn [test: apps/admin-api/src/modules/org/org-dept.service.int.test.ts » đổi tên: trả tên cũ, giữ name.en, version +1, trùng cùng cấp ⇒ NAME_TAKEN, cùng tên ⇒ không đổi]

#### Yêu cầu: Đổi trưởng phòng và chuyển phòng cha
Đổi trưởng phòng; chuyển phòng sang phòng cha khác: không vào con của chính nó (dept_cycle), không trùng tên ở cha mới.
- Kịch bản: khi đổi cha thì kiểm tên trùng và vòng [test: apps/admin-api/src/modules/org/org-dept.service.int.test.ts » đổi trưởng phòng, chuyển phòng cha (trùng tên ở cha mới ⇒ NAME_TAKEN, vào con của chính nó ⇒ dept_cycle)]

#### Yêu cầu: Mỗi người một phòng khi thêm/bớt thành viên
Thêm người vào phòng X ⇒ người đang ở phòng khác được chuyển sang X; bỏ khỏi X ⇒ về phòng cha (cấp trên cùng ⇒ về công ty). Trưởng phòng của phòng khác không chuyển được (409), trưởng phòng của chính phòng không bỏ được. Cả lô hoặc không gì cả.
- Kịch bản: khi thêm người phòng khác thì chuyển và trả phòng cũ để hoàn tác [test: apps/admin-api/src/modules/org/org-dept.service.int.test.ts » thêm người chưa có phòng, thêm lại ⇒ already, người phòng khác ⇒ CHUYỂN (rời hẳn phòng cũ)]
- Kịch bản: khi người đang ở nhiều phòng thì rời mọi phòng ban cũ, Group không phải phòng ban giữ nguyên [test: apps/admin-api/src/modules/org/org-dept.service.int.test.ts » người đang ở nhiều phòng (dữ liệu cũ) ⇒ khi thêm vào phòng khác rời mọi phòng ban cũ, Group không phải phòng ban giữ nguyên]
- Kịch bản: khi người là trưởng phòng khác thì 409 MEMBER_IS_HEAD và cả lô lùi [test: apps/admin-api/src/modules/org/org-dept.service.int.test.ts » trưởng phòng của phòng khác ⇒ 409 MEMBER_IS_HEAD, cả lô lùi (người khác trong lô không bị chuyển)]
- Kịch bản: khi người công ty khác, đối tác hoặc phòng công ty khác thì lỗi và không ghi [test: apps/admin-api/src/modules/org/org-dept.service.int.test.ts » người công ty khác / không tồn tại ⇒ NOT_FOUND, đối tác ⇒ 422, phòng công ty khác ⇒ NOT_FOUND, không ghi]
- Kịch bản: khi bỏ khỏi phòng thì về phòng cha, cấp trên cùng về công ty [test: apps/admin-api/src/modules/org/org-dept.service.int.test.ts » bỏ khỏi phòng ⇒ về phòng cha, phòng cấp trên cùng ⇒ về công ty, không phải thành viên ⇒ không đổi]
- Kịch bản: khi bỏ trưởng phòng của chính phòng thì 409, người còn ở phòng khác không bị kéo về cha [test: apps/admin-api/src/modules/org/org-dept.service.int.test.ts » bỏ trưởng phòng của chính phòng ⇒ 409 MEMBER_IS_HEAD, người còn ở phòng ban khác ⇒ không kéo thêm về cha]

#### Yêu cầu: Chuyển người báo trước quyền theo nhóm đổi
Mỗi lời gọi chuyển/bỏ trả số quyền do nhóm cấp được thêm/mất (`access {gained, lost}`); quyền còn từ nhóm khác hoặc cấp trực tiếp cho người thì không mất.
- Kịch bản: khi chuyển người giữa phòng có quyền khác nhau thì báo đúng gained/lost [test: apps/admin-api/src/modules/org/org-dept.service.int.test.ts » rời phòng có quyền F, đến phòng có quyền G ⇒ lost 1, gained 1, quyền F còn từ nhóm khác ⇒ không mất, cấp trực tiếp không tính]
- Kịch bản: khi bỏ khỏi phòng về phòng cha có quyền thì báo đúng [test: apps/admin-api/src/modules/org/org-dept.service.int.test.ts » phòng đến = phòng cha có quyền khi bỏ ⇒ báo được/mất đúng]

#### Yêu cầu: Xoá phòng chỉ khi rỗng
Xoá phòng bị chặn khi còn người (thành viên hoặc trưởng phòng) hoặc phòng con: 409 `DEPT_NOT_EMPTY` kèm `{members, children}`. Phòng rỗng: xoá cả Group, trừ khi Group còn quyền theo nhóm/vai (khi đó chỉ bỏ đánh dấu phòng ban).
- Kịch bản: khi phòng còn người hoặc con thì 409 kèm số [test: apps/admin-api/src/modules/org/org-dept.service.int.test.ts » còn người (kể cả chỉ có trưởng phòng) hoặc còn phòng con ⇒ 409 DEPT_NOT_EMPTY kèm số, không xoá gì]
- Kịch bản: khi phòng rỗng thì xoá cả Group [test: apps/admin-api/src/modules/org/org-dept.service.int.test.ts » phòng rỗng ⇒ xoá cả Group, con rỗng xoá trước rồi cha xoá được, công ty khác ⇒ NOT_FOUND]
- Kịch bản: khi Group còn quyền theo nhóm thì giữ Group và quyền [test: apps/admin-api/src/modules/org/org-dept.service.int.test.ts » Group còn quyền theo nhóm (feature_grants) ⇒ chỉ bỏ đánh dấu phòng ban, Group + quyền giữ nguyên]

#### Yêu cầu: Xoá phòng không làm mất cấu hình Hub
Group còn được dùng ở agent, quy trình hoặc từng được giao việc duyệt thì chỉ bỏ đánh dấu phòng ban, Group giữ nguyên; việc duyệt đang mở giao cho nhóm chặn xoá (409 `DEPT_IN_USE`). Tham chiếu của công ty khác không tính.
- Kịch bản: khi Group có agent theo nhóm thì giữ Group [test: apps/admin-api/src/modules/org/org-dept.hub.int.test.ts » agent_grants theo nhóm ⇒ chỉ bỏ đánh dấu phòng ban, Group + quyền agent giữ]
- Kịch bản: khi quy trình chạy được bởi nhóm thì giữ Group [test: apps/admin-api/src/modules/org/org-dept.hub.int.test.ts » quy trình có run_group_ids chứa nhóm ⇒ giữ Group]
- Kịch bản: khi nhóm từng được giao việc duyệt đã đóng thì giữ Group [test: apps/admin-api/src/modules/org/org-dept.hub.int.test.ts » việc duyệt đã đóng từng giao cho nhóm (cả hai dạng) ⇒ giữ Group]
- Kịch bản: khi việc duyệt đang mở giao cho nhóm thì 409 DEPT_IN_USE kèm số [test: apps/admin-api/src/modules/org/org-dept.hub.int.test.ts » việc duyệt ĐANG MỞ giao cho nhóm (assignee_group_id hoặc review_task_assignees) ⇒ 409 DEPT_IN_USE kèm số, không xoá gì]
- Kịch bản: khi tham chiếu thuộc công ty khác thì vẫn xoá hẳn [test: apps/admin-api/src/modules/org/org-dept.hub.int.test.ts » tham chiếu của công ty khác không làm giữ Group, Group không dùng ở đâu ⇒ xoá hẳn]
- Kịch bản: khi quản trị công ty khác gọi hàm tham chiếu thì 42501 [test: apps/admin-api/src/modules/org/org-dept.hub.int.test.ts » quản trị công ty khác gọi với id công ty này ⇒ 42501, đúng công ty ⇒ ok]

#### Yêu cầu: Xoá phòng báo lỗi khi không đọc được tham chiếu Hub
Có bảng Hub mà hàm tham chiếu không gọi được thì xoá phòng báo lỗi (INTERNAL_ERROR, hub_refs_unavailable), không xoá Group; chuyển người vẫn chạy.
- Kịch bản: khi hàm hub.org_group_refs không cấp cho admin_rw thì xoá phòng báo lỗi và Group còn nguyên [test: apps/admin-api/src/modules/org/org-dept.hub.int.test.ts » có bảng Hub nhưng hàm hub.org_group_refs không cấp cho admin_rw ⇒ xoá phòng báo lỗi, KHÔNG xoá Group, phòng còn nguyên]

#### Yêu cầu: access tính cả agent và quy trình
Số quyền được thêm/mất khi chuyển người tính cả agent theo nhóm và quy trình chạy được theo nhóm.
- Kịch bản: khi rời nhóm có agent và quy trình, đến nhóm có cùng agent thì chỉ mất quy trình [test: apps/admin-api/src/modules/org/org-dept.hub.int.test.ts » rời nhóm có agent X + quy trình P, đến nhóm có agent X ⇒ chỉ mất P, không còn nhóm nào ⇒ mất cả hai]
- Kịch bản: khi vào nhóm có agent và quy trình thì được thêm cả hai [test: apps/admin-api/src/modules/org/org-dept.hub.int.test.ts » vào nhóm có agent + quy trình (2 người × 2 mục) ⇒ gained 4]

#### Yêu cầu: Người được giao thêm, chuyển, bỏ người
Quản trị khác người tạo dữ liệu thêm/chuyển/bỏ người; hàng và audit ghi đúng người thực hiện.
- Kịch bản: khi quản trị khác người tạo chuyển và bỏ người thì hàng ghi đúng người thực hiện [test: apps/admin-api/src/modules/org/org-dept.hub.int.test.ts » binh thêm U1,U2 vào A, chi chuyển U1 sang B và bỏ U2 khỏi A (về cha), binh chuyển U2 lại, hàng ghi đúng người]

#### Yêu cầu: Key Group sinh từ tên có trần
Key sinh từ tên (bỏ dấu); trùng thì thêm hậu tố, quá 1000 lần thử thì KEY_TAKEN.
- Kịch bản: khi tên trùng nhiều lần thì thêm hậu tố, quá 1000 lần thì KEY_TAKEN [test: apps/admin-api/src/modules/org/org.shared.test.ts » trùng ⇒ hậu tố -2, -3…, quá 1000 lần thử ⇒ KEY_TAKEN thay vì lặp mãi]

#### Yêu cầu: Hai thao tác cơ cấu đồng thời không vỡ
Mọi thao tác sửa cơ cấu khoá theo công ty trước, nên hai thao tác cùng lúc nối tiếp nhau, không deadlock, không vòng, không người ở hai phòng, không phòng mất mà còn thành viên.
- Kịch bản: khi cùng một người thêm vào hai phòng cùng lúc thì cuối cùng đúng một phòng [test: apps/admin-api/src/modules/org/org-dept.service.int.test.ts » cùng một người thêm vào hai phòng cùng lúc ⇒ không lỗi, cuối cùng đúng một phòng]
- Kịch bản: khi hai lần tạo cùng tên cùng cấp thì một thành công một NAME_TAKEN [test: apps/admin-api/src/modules/org/org-dept.service.int.test.ts » hai lần tạo cùng tên cùng cấp ⇒ đúng một thành công, một NAME_TAKEN]
- Kịch bản: khi hai lần đổi cha chéo nhau thì không tạo vòng [test: apps/admin-api/src/modules/org/org-dept.service.int.test.ts » hai lần đổi cha chéo nhau (A→con B, B→con A) ⇒ không tạo vòng]
- Kịch bản: khi xoá phòng và thêm người vào đó cùng lúc thì không có phòng mất mà còn thành viên [test: apps/admin-api/src/modules/org/org-dept.service.int.test.ts » xoá phòng và thêm người vào chính phòng đó cùng lúc ⇒ hoặc xoá thành công (người không vào), hoặc bị chặn, không bao giờ phòng mất mà còn thành viên]

#### Yêu cầu: Chỉ quản trị sửa cơ cấu
Chỉ platform_admin (nêu công ty) và tenant_admin của công ty mình; nhân viên thường 403 trước khi tra thực thể; chưa đăng nhập 401; quản trị công ty khác 404.
- Kịch bản: khi nhân viên thường gọi thì 403, chưa đăng nhập 401 và không ghi gì [test: apps/admin-api/src/modules/org/org-dept.routes.int.test.ts » member (an) ⇒ 403 ở mọi thao tác sửa cơ cấu, kể cả khi id không tồn tại, không đăng nhập ⇒ 401, không ghi gì]
- Kịch bản: khi platform_admin gọi thiếu tenant_id thì 400 TENANT_REQUIRED [test: apps/admin-api/src/modules/org/org-dept.routes.int.test.ts » platform_admin phải nêu ?tenant_id khi ghi (thiếu ⇒ 400 TENANT_REQUIRED), có ⇒ ghi đúng công ty]
- Kịch bản: khi quản trị khác người tạo sửa thì chạy đủ hành trình tạo, đổi tên, chuyển, bỏ, xoá [test: apps/admin-api/src/modules/org/org-dept.routes.int.test.ts » binh tạo phòng, chi (quản trị khác) đổi tên, chuyển người, bỏ người, bị chặn xoá khi còn người, rồi xoá khi rỗng]
- Kịch bản: khi lỗi nghiệp vụ thì mã và details đúng [test: apps/admin-api/src/modules/org/org-dept.routes.int.test.ts » trưởng phòng phòng khác ⇒ 409 MEMBER_IS_HEAD kèm id, tên trùng cùng cấp ⇒ 409 NAME_TAKEN, thêm quá 50 người ⇒ 400]
- Kịch bản: khi quản trị công ty khác gọi thì 404 [test: apps/admin-api/src/modules/org/org-dept.routes.int.test.ts » quản trị công ty khác (hoa, globex) ⇒ 404 ở mọi thao tác trên phòng của acme, không ghi]
- Kịch bản: khi quản trị công ty khác thao tác ở tầng service thì NOT_FOUND [test: apps/admin-api/src/modules/org/org-dept.service.int.test.ts » quản trị công ty khác (kể cả khi biết id) ⇒ NOT_FOUND ở mọi thao tác, không ghi]

## Việc còn lại
- Chạy `external-deny.int.test.ts` + toàn bộ file org trên evotest lần cuối (xem báo cáo). Chưa e2e (lát #5 viết, điều phối chạy cuối đợt).
- `admin-web` `DeptCard`/`api.ts` còn gọi `DELETE /admin/org/departments/:id` theo nghĩa cũ (gỡ đánh dấu) ⇒ nay 409 khi còn người/con; lát #5 thay UI. `e2e/contracts-web/org-visibility.cw.ts:134` bắt URL này — kiểm lại ở lát #5.
- Seed demo `tools/scripts/src/seed-demo-partner.org.io.ts` gọi `PUT /admin/org/departments/:id` (giữ nguyên hành vi).
