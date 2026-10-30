# 2026-09-28 - Tenants, three kinds of account, invite by e-mail, live access catalog

fen asked for these 7 things:
1. Three kinds of account:
   - **system-admin**: everything, on Keycloak and on KH.
   - **tenant-admin**: the Keycloak admin console, for their own company only.
   - **kh-users**: KH only.
2. One tenant per company.
3. A project owner adds a person by e-mail through the LLM. The Keycloak account is created
   automatically; the owner does not ask an admin.
4. An API that tells assistants the current roles, so a change is seen at the next read.
5. A shared project `knowledge` that every user reads by default, while its owners and editors edit it.
6. The orchestrator and the hot log must stay per user.
7. Deploy.

Most of the work is in the Keycloak repo (C:\Workspaces\Keycloak, branch kh-main-personal). The KH
repo holds kh-helper 1.7.0 and the guide.

## Access model (Keycloak repo, deploy/kh-auth)

- **`schema.sql` (views replaced on the live schema with `seed.py --replace-views`):**
  - `KH_AUTH_USER_ROLE`: a role counts when it is held directly, through a group, or through that
    group's parent.
  - `KH_AUTH_USER_TENANT`: membership of `/tenants/<t>` and of `/tenants/<t>/tenant-admins`.
  - `KH_AUTH_TENANT_PROJECT`: a project's tenant is the tenant of its **creator** only. An owner from
    another company therefore does not bring their own tenant admin into the project.
  - `KH_AUTH_EFFECTIVE_ACCESS`, rule 4: a tenant admin gets the owner level on every project of the
    tenant, orphans included.
  - `KH_AUTH_EFFECTIVE_ACCESS`, rule 5: a new column `KH_AUTH_PROJECT.DEFAULT_LEVEL` gives that level
    to every active user.
- **`catalog.json`:** `default_levels: {"knowledge": "readonly"}`. `seed.py` applies it and adds the
  column when it is missing. The DDL runs in one transaction (`SET TRANSACTION AUTOCOMMIT DDL OFF`).
- **Checks:**
  - Access snapshots taken before and after each view change were identical. The only differences
    came from the new groups themselves.
  - `test_access.py`: 30 rule checks, all rolled back, now covering groups, tenants, cross-tenant
    owners and default levels.

## Realm (deploy/btp/configure_tenants.py, new, idempotent; configure_realm.py)

- **Groups in knowledge-hub:**
  - `kh-users` (role member).
  - `system-admin` (role maintainer + realm-admin).
  - `/tenants/laidon` and `/tenants/simplemdg`, each with role member and a `domains` attribute.
  - `/tenants/<t>/tenant-admins`, with query-users and query-groups.
  - Each group carries its own description.
- **Fine-grained admin permissions v2** (realm `adminPermissionsEnabled`). A tenant's admins may:
  - view and manage the members of their tenant group;
  - put people into their tenant and into kh-users;
  - see the `tenants` group itself, which is needed to resolve `/tenants/<t>`.
- **master:** group `system-admin` (role admin), holding `rowan.hoang@laidon.com`.
- **User profile:** `unmanagedAttributePolicy=ADMIN_VIEW`, so that `kh.invited_by` and `kh.invited_at`
  are kept.
- **configure_realm.py:** no Account Console for KH users (applied earlier the same day).
- **Placement, per fen:**
  - laidon: rowan.hoang@laidon.com, logan59102@gmail.com, nghiephoang2905@gmail.com.
  - simplemdg: rowan.hoang@simplemdg.com.
  - Tenant admin of both: nghiephoang2905@gmail.com.
  - System admin: rowan.hoang@laidon.com, who is now a maintainer in KH.

## Keycloak extension and fork

- **`KhUserProvisioner` (new):** when `PUT /realms/knowledge-hub/kh/projects/{id}/members/{email}` is
  called by someone with `project.members.manage` for an e-mail that is **not in the realm at all**:
  - the user is created in `kh-users`;
  - the tenant is the one whose domain matches the e-mail, otherwise the inviter's tenant;
  - the invite is recorded in `kh.invited_by` and `kh.invited_at`;
  - the answer is 201 `{created_user: true, tenant}`.
  - A user who exists but is disabled or has no KH role is **never** revived this way (400).
- **`GET /realms/knowledge-hub/kh/catalog`:** read live from the database and served to any KH user.
  It returns roles, levels, permissions, the role and level mappings, the kinds of account (from the
  group descriptions), the tenants, and the default-level projects.
- **Fork bug fixed:** `JPAPolicyStore.findDependentPolicies` compared `POLICY_CONFIG.VALUE` (NCLOB) with
  `=`. HANA refuses that ("Cannot compare NCLOB and NCLOB"), which made any fine-grained permission
  check answer 500. It now uses `LIKE` with every wildcard escaped.
- **Deployed:** `kh-keycloak` twice, first the extension and then the patched model-jpa jar.

## KH repo

- **kh-helper 1.7.0:**
  - new commands `kh members list|add|remove` and `kh catalog`;
  - new MCP tools `kh_members` and `kh_catalog`;
  - new method `Session.call_identity`, which calls Keycloak's `/kh` API with the person's own token.
- **Guide:** a new "People and roles" section. The guide was pushed to prod and dev.
- **New project `knowledge`** (default level readonly). It holds a row that points to the catalog API
  and to /auth/help.

## Verified live

**Sign-in and invites (prod):**
- KH sign-in still works after both Keycloak deploys.
- An owner added a brand-new e-mail as editable:
  - the answer was 201 and the user was created;
  - `@example.invalid` went to the inviter's tenant;
  - `@simplemdg.com` went to simplemdg;
  - `kh.invited_by` was set.
- A disabled person answered 400.
- Someone who does not manage the project answered 403.
- The catalog answers 401 without a token.

**Kinds of account on the admin API:**
- kh-user: 403.
- Tenant-admin of laidon:
  - lists only the 3 laidon people;
  - gets 403 on simplemdg's user;
  - creates a user in `/tenants/laidon` (201);
  - gets 403 when putting that user into system-admin.
- The test client's full scope was switched on for this test only and switched back.

**Shared project and isolation:**
- `knowledge`: a member reads it (200) and cannot write it (403).
- Orchestrator and hot log for a plain member: projects, registry, log/recent, log/window,
  project_match, vector query and scroll, findings, policy, hooks, personalization and graph_read
  leak no other project. The only orchestrator knowledge row a member reads is the public guide.

## Common SessionStart hook (later the same day)

- **Why:** an assistant on a freshly set-up machine had no KH rules at session start. On prod,
  `/hooks/raw?hook_type=SessionStart` was empty for everyone, because the single-user hooks were not
  migrated on 2026-09-26. Its only clues were the MCP instructions and the tool descriptions.
- **What:** `POST /hooks/set {hook_type: SessionStart, name: kh-access-model, position: 0}` on prod
  (id 1) and dev (id 4). It is the only hook row on each. The text is 943 characters and tells the
  assistant to:
  - read `kh_catalog` live;
  - find shared knowledge in `knowledge`;
  - treat the orchestrator as read-only for members;
  - add people with `kh_members`: an unknown e-mail gets an account, the default level is readonly;
  - take a 403 as final;
  - use `kh_help` for connecting, signing out and uninstalling.
- **Verified:** a plain member's `GET /hooks/raw?hook_type=SessionStart` on prod returns it.
- **Storage:** hooks are stored in HANA through `app/sqldb.py`, so redeploys keep it.

## Invites restricted, roles made data (later the same day)

**Rule (fen):** only a tenant admin or a system admin brings a NEW person in.
- A project owner adds people who already have an account.
- For an unknown e-mail the owner gets 403 `{account_required: true, ask: [tenant admins]}` and is
  told whom to ask.
- A tenant admin creates people only inside a tenant they administer. An e-mail whose domain
  belongs to another tenant is refused, with that tenant's admins to ask.

**Made data-driven** at fen's request ("adjust the scope of a role, no code"):
- The new realm role `tenant-admin` is carried by `/tenants/<t>/tenant-admins`.
- `KH_AUTH_ROLE.PROJECT_SCOPE` is `all` or `tenant`.
- The view `KH_AUTH_USER_KH_ROLE` lists every KH role a person holds. The codes come from
  `KH_AUTH_ROLE`, so a new role needs a row and a realm role, not code.
- Rules 1 and 4 of `KH_AUTH_EFFECTIVE_ACCESS`, and the KH-wide permissions, read
  `KH_AUTH_ROLE_PERMISSION` by scope.
- `catalog.json`: new role `tenant-admin` (scope `tenant`: owner-level project permissions plus
  `kh.users.invite`) and new permission `kh.users.invite` (maintainer, tenant-admin).
- The extension reads `permissionScope(email, 'kh.users.invite')`. The token claim now also
  carries `roles`.
- `test_access.py`: 36 checks. One of them deletes a role permission row and sees the right go at
  once.

**Rollout:**
- After `seed.py --replace-views` the only access difference on prod was `kh.users.invite` for
  the two admins.
- Checked live:
  - owner adds an unknown e-mail: 403 with the ask list;
  - owner adds an existing person: 204;
  - tenant admin adds an unknown e-mail: 201, in laidon;
  - laidon admin adds `@simplemdg.com`: 403.
- kh-helper 1.7.1 changes the tool and CLI text only. The guide and the common SessionStart hook
  were updated on prod and dev.

**Hugh:** `logan59102@gmail.com` is now tenant admin of laidon.

**Account Console read-only:** with the console switched off, a member who signed in at Keycloak
saw "Client disabled" and believed the sign-in had failed.
- The console is on again, and the default roles hold only `account:view-profile`
  (`configure_realm.ensure_read_only_account_console`).
- Checked: the sign-in page answers 302; a member reads their own profile (200); an edit is
  refused (403).

**Workbeats guide** in project `knowledge`:
- The topics are `workbeats-log-work`, `workbeats-api` and `workbeats-helper`, taken from the
  Workbeats handoff.
- Section 6 of the source said to round short days up to 8h "so it never reads like padding". It
  was replaced by "log the time actually spent; say when a day is under or over 8h". Rounding up
  would mean publishing a timesheet-padding rule to everyone.

## Open

- The admin console itself (the UI) was not driven by a person yet. The admin API behind it was.
- `security-admin-console` needs a person to sign in as a tenant admin once.
