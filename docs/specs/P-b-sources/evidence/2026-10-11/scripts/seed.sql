\set T '''01a11c1d-ca4e-7000-b4eb-212defbb548f'''
insert into hub.agents (key,name,description,runtime,profile_id,system_prompt,timeout_s,token_budget) values
 ('pb-doc-claude','{"vi":"Rà nguồn (Claude thật)","en":"Source reader (real Claude)"}','Agent UAT P-b: đọc nguồn tham chiếu bằng Claude thật, trần 50k token.','agentic-cli','99e6b0da-25b5-44d7-96e0-3d6fd40a0f61','Bạn đọc mã nguồn/tài liệu trong thư mục sources/ và trả lời ngắn gọn bằng tiếng Việt. Chỉ đọc, không ghi.',600,50000),
 ('pb-doc-fake','{"vi":"Rà nguồn (fake-cli)","en":"Source reader (fake-cli)"}','Agent UAT P-b: đọc nguồn tham chiếu bằng fake-cli (kiểm luồng).','agentic-cli','ab6eb3e3-6afa-4b34-addc-7ed020d75b7c','Bạn đọc nguồn và viết output theo đúng các mục.',600,null)
on conflict (key) do nothing;
insert into hub.agent_entitlements (agent_id,tenant_id) select id,:T::uuid from hub.agents where key in ('pb-doc-claude','pb-doc-fake','backend-lead','frontend-lead') on conflict do nothing;
insert into hub.agent_team_entitlements (team_id,tenant_id) select id,:T::uuid from hub.agent_teams where key='plan-team' on conflict do nothing;
insert into hub.agent_grants (agent_id,tenant_id,subject_type,subject_id)
 select a.id,:T::uuid,'user',u.id from hub.agents a, admin.users u
 where a.key in ('pb-doc-claude','pb-doc-fake','backend-lead','frontend-lead') and u.tenant_id=:T::uuid
 and not exists (select 1 from hub.agent_grants g where g.agent_id=a.id and g.subject_id=u.id);
select key from hub.agents where key like 'pb-%';
