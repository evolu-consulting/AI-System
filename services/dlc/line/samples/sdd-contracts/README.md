# Sample: a contract app run by an AI-SDLC process

A worked example for processes as data (docs/dlc/process.md), used by the happy-case tests and by anyone trying
the Admin process screens.

- `app/`: the target repository (a tiny contract library with tests), including the onboarding pack people
  prepared for the agents: business documents (`docs/business`), technical skills (`docs/technical`), sample data
  (`data/`) and the project's own rules (`.dlc/constitution.md`)
- `process.json`: the process `contract-change` as an admin saves it (it extends the built-in `gated-change`):
  owner, KPIs, needs with the role that supplies each, approvers, supervisor and incident role per step,
  auto-approve criteria for the spec and plan gates, a plan-gate route back to the spec
- `requests/`: two small change requests of the same kind (the second one is auto-approved once people approved
  the first)

Try it: POST `process.json` to /api/admin/processes, publish it, bind a project to it for `enhancement`, and
start a run with `requests/add-tax-code`.
