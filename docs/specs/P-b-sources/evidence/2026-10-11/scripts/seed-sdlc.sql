\set T '''01a11c1d-ca4e-7000-b4eb-212defbb548f'''
-- nhóm chạy / duyệt
insert into admin.groups (tenant_id,key,name,description) values
 (:T::uuid,'sdlc-runners','{"vi":"SDLC - người chạy","en":"SDLC runners"}','Nhóm được chạy quy trình sdlc-evolu'),
 (:T::uuid,'sdlc-reviewers','{"vi":"SDLC - người duyệt","en":"SDLC reviewers"}','Nhóm duyệt cổng review sdlc-evolu')
on conflict do nothing;
insert into admin.group_members (tenant_id,group_id,user_id)
 select :T::uuid,g.id,u.id from admin.groups g join admin.users u on u.tenant_id=g.tenant_id
 where g.tenant_id=:T::uuid and ((g.key='sdlc-runners' and u.username='thomas.tran') or (g.key='sdlc-reviewers' and u.username in ('vio.ngo','edgar.nguyen')))
on conflict do nothing;
-- agent claude-sub, trần 300k
insert into hub.agents (key,name,description,runtime,profile_id,system_prompt,timeout_s,token_budget) values
 ('sdlc-claude','{"vi":"SDLC (Claude thật)","en":"SDLC (real Claude)"}','Agent sdlc-evolu: đọc nguồn ai-system-local (Read/Grep/Glob), ghi output vào out/. Không sửa repo.','agentic-cli','99e6b0da-25b5-44d7-96e0-3d6fd40a0f61','Bạn là kỹ sư phân tích lỗi (fix-bug). Chỉ dùng Read/Grep/Glob đọc thư mục sources/ và ghi output vào out/. TUYỆT ĐỐI không sửa repo/nguồn. Trả lời tiếng Việt, súc tích, trích file:dòng thật.',900,300000),
 ('sdlc-analyst','{"vi":"SDLC - Phân tích","en":"SDLC analyst"}','Thành viên team: phân tích bug từ code thật.','agentic-cli','99e6b0da-25b5-44d7-96e0-3d6fd40a0f61','Bạn là người phân tích lỗi. Chỉ Read/Grep/Glob thư mục sources/, ghi vào out/. Không sửa repo. Trích file:dòng thật.',900,300000),
 ('sdlc-patcher','{"vi":"SDLC - Đề xuất patch","en":"SDLC patcher"}','Thành viên team: đề xuất patch (diff) dựa trên phân tích trước đó.','agentic-cli','99e6b0da-25b5-44d7-96e0-3d6fd40a0f61','Bạn đề xuất PATCH cụ thể (file:dòng + diff) từ code thật. Chỉ Read/Grep/Glob thư mục sources/, ghi vào out/. KHÔNG tự sửa repo.',900,300000)
on conflict (key) do update set token_budget=excluded.token_budget, system_prompt=excluded.system_prompt, timeout_s=excluded.timeout_s;
insert into hub.agent_teams (key,name,description,mode,limits) values
 ('sdlc-team','{"vi":"Nhóm SDLC fix-bug","en":"SDLC fix-bug team"}','Phân tích rồi đề xuất patch (Claude thật).','sequential','{"max_calls": 10, "max_tokens": 400000, "max_active_s": 1800, "max_plan_steps": 5, "summary_tokens": 200}')
on conflict (key) do update set limits=excluded.limits;
insert into hub.agent_team_members (team_id,agent_id,role,sections,position)
 select t.id,a.id,v.role,v.sections::text[],v.pos from hub.agent_teams t,
 (values ('sdlc-analyst','Phân tích','{"Phân tích"}',0),('sdlc-patcher','Đề xuất','{"Đề xuất","Nguồn tham chiếu"}',1)) v(ak,role,sections,pos)
 join hub.agents a on a.key=v.ak where t.key='sdlc-team'
on conflict do nothing;
insert into hub.agent_entitlements (agent_id,tenant_id) select id,:T::uuid from hub.agents where key like 'sdlc-%' on conflict do nothing;
insert into hub.agent_team_entitlements (team_id,tenant_id) select id,:T::uuid from hub.agent_teams where key='sdlc-team' on conflict do nothing;
insert into hub.agent_grants (agent_id,tenant_id,subject_type,subject_id)
 select a.id,:T::uuid,'user',u.id from hub.agents a, admin.users u
 where a.key like 'sdlc-%' and u.tenant_id=:T::uuid
 and not exists (select 1 from hub.agent_grants g where g.agent_id=a.id and g.subject_id=u.id);
select key from hub.agents where key like 'sdlc-%';
select id,key from admin.groups where tenant_id=:T::uuid;
