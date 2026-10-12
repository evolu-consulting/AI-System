-- UAT: gỡ "Bàn giao" khỏi stage 4 (Tổng hợp) của pb2-uat-edit để kiểm R10 (UI lưu => Hub tự thêm lại).
update hub.process_defs set stages = jsonb_set(stages,'{3,output}', '{"fields":[],"filename":"tong-hop.md","template":"## Kết quả\n","required_sections":["Kết quả"]}'::jsonb)
 where key='pb2-uat-edit' and tenant_id='01a11c1d-ca4e-7000-b4eb-212defbb548f';
select stages->3->'output' from hub.process_defs where key='pb2-uat-edit' and tenant_id='01a11c1d-ca4e-7000-b4eb-212defbb548f';
