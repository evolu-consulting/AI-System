\set T '''01a11c1d-ca4e-7000-b4eb-212defbb548f'''
insert into hub.agents (key,name,description,runtime,profile_id,system_prompt,timeout_s,token_budget) values
 ('pb2-claude','{"vi":"UAT P-b2 (Claude thật)","en":"UAT P-b2 (real Claude)"}','Agent UAT P-b2: Claude thật, trả lời cực ngắn, không đọc nguồn.','agentic-cli','99e6b0da-25b5-44d7-96e0-3d6fd40a0f61','Bạn là trợ lý UAT. KHÔNG dùng công cụ nào. Trả lời CỰC NGẮN bằng tiếng Việt (tối đa 3 dòng) và viết đúng các mục được yêu cầu.',600,60000)
on conflict (key) do nothing;
insert into hub.agent_entitlements (agent_id,tenant_id) select id,:T::uuid from hub.agents where key in ('pb2-claude') on conflict do nothing;
insert into hub.agent_grants (agent_id,tenant_id,subject_type,subject_id)
 select a.id,:T::uuid,'user',u.id from hub.agents a, admin.users u
 where a.key in ('pb2-claude') and u.tenant_id=:T::uuid
 and not exists (select 1 from hub.agent_grants g where g.agent_id=a.id and g.subject_id=u.id);
select key,id from hub.agents where key like 'pb2-%';
