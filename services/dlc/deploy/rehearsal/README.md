# Rehearsal tools (INTERNAL - do not ship to customers)

Run the customer install on a NON-elevated build machine, from the built kit only, before going to the VPS.

- `rehearse-local.ps1 -Kit <kit folder> -Root <scratch folder> -Ip <this host's LAN IP>`: same steps and
  environment as `windows/install-stack.ps1` + `windows/seed-stack.ps1`, but as plain processes (no Windows
  services, no firewall, no machine certificate store: `SSL_CERT_FILE` instead), on separate ports
  (Keycloak 18443, KH 19300, engine 18796, frontend 18795, apps 19100-19199) so a dev stack keeps running.
- `demo_e2e.py`: the demo end to end through the frontend proxy with a real Keycloak user token (refreshed via
  `keycloak/test-login.ps1 -TokenFile`): tiny web-app spec -> New System run (decide) -> pause + resume ->
  green -> nodes, worklog, reports -> Start app -> GET the app URL -> Stop app. Real model calls (a few USD cap).

Keycloak admin recovery (also on the VPS, server stopped):
`kc.bat bootstrap-admin user --username admin2 --password:env KC_ADMIN_PW --no-prompt`.
