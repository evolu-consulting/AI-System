#!/usr/bin/env bash
# sohoptac2-staging · kiem seed bang SQL: tenant demo co «Quy trinh mua hang» da gan + thanh vien nhom duyet (PURCHASE_ROLE_GROUPS). Chi doc.
#   bash verify.sh
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh
q() { dc exec -T pg psql -v ON_ERROR_STOP=1 -U s2_owner -d ai_system -P pager=off "$@"; }
echo "--- quy trinh da gan cho tenant demo (company_flows):"
q -c "select d.name, cf.enabled from hub.company_flows cf join admin.tenants t on t.id = cf.tenant_id join hub.process_defs d on d.id = cf.flow_id where t.key = 'demo' and d.deleted_at is null order by d.name"
echo "--- «Quy trinh mua hang» gan + bat (mong >= 1):"
q -tA -c "select count(*) from hub.company_flows cf join admin.tenants t on t.id = cf.tenant_id join hub.process_defs d on d.id = cf.flow_id where t.key = 'demo' and cf.enabled and d.deleted_at is null and d.name ilike 'Quy trình mua hàng%'"
echo "--- thanh vien nhom duyet cua demo (nhom: so thanh vien):"
q -c "select g.key, count(m.user_id) as members, string_agg(u.username, ',' order by u.username) as users from admin.groups g join admin.tenants t on t.id = g.tenant_id left join admin.group_members m on m.group_id = g.id left join admin.users u on u.id = m.user_id where t.key = 'demo' and g.key in ('giam-doc','tai-chinh','ke-toan','ke-toan-truong','thu-quy','phap-che','truong-bo-phan','mua-hang','truong-mua-hang','kho','nhan-vien-phong-ban') group by g.key order by g.key"
echo "--- co flow_triggers:"
q -tA -c "select s.flow_triggers from hub.tenant_flow_settings s join admin.tenants t on t.id = s.tenant_id where t.key = 'demo'"
