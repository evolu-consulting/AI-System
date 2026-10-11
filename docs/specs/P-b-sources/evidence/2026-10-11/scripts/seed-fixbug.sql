\set T '''01a11c1d-ca4e-7000-b4eb-212defbb548f'''
insert into admin.groups (tenant_id,key,name,description) values
 (:T::uuid,'fixbug-runners','{"vi":"Fixbug - người chạy","en":"Fixbug runners"}','Nhóm được chạy quy trình fixbug-evolu')
on conflict do nothing;
insert into admin.group_members (tenant_id,group_id,user_id)
 select :T::uuid,g.id,u.id from admin.groups g join admin.users u on u.tenant_id=g.tenant_id
 where g.tenant_id=:T::uuid and g.key='fixbug-runners' and u.username='thomas.tran'
on conflict do nothing;
insert into hub.agents (key,name,description,runtime,profile_id,system_prompt,timeout_s,token_budget) values
 ('fixbug-claude','{"vi":"Fixbug (Claude thật)","en":"Fixbug (real Claude)"}','Agent fixbug-evolu: đọc nguồn ai-system-local chỉ-đọc, xuất chẩn đoán/kế hoạch/patch/rà soát.','agentic-cli','99e6b0da-25b5-44d7-96e0-3d6fd40a0f61','Bạn là kỹ sư fix-bug. Chỉ dùng Read/Grep/Glob đọc thư mục sources/. Không sửa repo. Làm đúng instruction của stage.',900,300000)
on conflict (key) do update set token_budget=excluded.token_budget, system_prompt=excluded.system_prompt, timeout_s=excluded.timeout_s;
insert into hub.agent_entitlements (agent_id,tenant_id) select id,:T::uuid from hub.agents where key='fixbug-claude' on conflict do nothing;
insert into hub.agent_grants (agent_id,tenant_id,subject_type,subject_id)
 select a.id,:T::uuid,'user',u.id from hub.agents a, admin.users u
 where a.key='fixbug-claude' and u.tenant_id=:T::uuid
 and not exists (select 1 from hub.agent_grants g where g.agent_id=a.id and g.subject_id=u.id);
select id,key from admin.groups where key='fixbug-runners';
select id,key from hub.agents where key='fixbug-claude';
