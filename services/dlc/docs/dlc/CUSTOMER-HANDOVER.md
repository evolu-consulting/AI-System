# Handover sheet

Filled in by the operator at installation and given to the customer. Values in `<...>` are set per install.

## Addresses

| What | Address | Who uses it |
|---|---|---|
| Default frontend (sign in, start work, watch progress, open the delivered app) | `http://<server-ip>:<fe-port>` (default port 8795) | your users |
| Sign-in server (realm `dlc`) | `https://<server-ip>:<sign-in-port>/realms/dlc` (default port 8443) | your users' browsers, your frontend's backend |
| Engine API | `http://<server-ip>:<engine-port>` (default port 8796) | your own frontend's backend only |
| Engine API contract | `http://<server-ip>:<engine-port>/api/openapi.json` | your developers / coding agent |
| Delivered applications | `http://<server-ip>:<port>` with a port from `<app-port-range>` (default 9100-9199) | opened from the frontend's "Open app" button |

The sign-in server uses a certificate for `<server-ip>` (self-signed unless a real one was installed): accept
it once in each browser, or install the certificate file (given with this sheet) as a trusted root on the
client machines and on your backend.

## Accounts and clients

| Item | Value |
|---|---|
| Realm | `dlc` |
| Client for the default frontend | `dlc-fe` (already configured) |
| Client for **your own** frontend | `customer-fe` - public, authorization code + PKCE (S256); redirect URI `<your-redirect-uri>`, web origin `<your-origin>` (ask the operator to change them) |
| Audience the engine requires | `dlc-api` (both clients add it to their tokens) |
| Roles | `dlc-user` start / pause / resume work, open delivered apps; `dlc-admin` also cancel runs and stop apps; `dlc-viewer` read-only in the default frontend |
| First user | `<username>` (password handed over separately; change it at first sign-in) |
| Realm administration | by the operator |

## How the system works for you

- Upload a `.md` specification in the default frontend (New System, Enhancement or Bug Fix) and start it.
- The engine's agents do the work; nobody needs to answer questions: the model decides open points and logs
  each decision (visible in the node's work log).
- Watch progress on Home; click a stage to read what its agents did and the reports (implementation, tests,
  decisions, findings).
- Pause and resume a run at any time from Home.
- When a run completes, "Start app" starts the delivered application and opens it in a new tab.

## Connecting your own frontend

Give your coding agent the guide [FRONTEND-INTEGRATION.md](FRONTEND-INTEGRATION.md), the engine API address,
the realm address, the client id `customer-fe`, a test account and the certificate file. It contains every
request, the sign-in flow, the error codes and smoke tests to prove the connection.

## Support

| Topic | Contact |
|---|---|
| Accounts, roles, client redirect URIs | `<operator contact>` |
| Engine or knowledge store not answering | `<operator contact>` |
