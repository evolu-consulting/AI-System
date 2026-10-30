# Technical users: a worklog per real person (2026-10-20)

## Why

A technical user (TU) is one KH account an agent signs in with while serving several real users (RU).
Every RU of that agent saw every other RU's worklogs, because KH only knew the TU. The new optional
second key keeps each RU's worklogs apart. A worklog without the key is read exactly as before.

## How

Pattern: on-behalf-of with an actor token and a subject token (RFC 8693, Microsoft OBO).

- **TU marker.** The KH-wide permission `kh.act_for_user`, carried by Keycloak realm role
  `technical-user`. This is data in `deploy/kh-auth/catalog.json` (Keycloak repo) and needs no Java change.
- **Proof of the RU.** The TU sends its own token in `Authorization` and the RU's own KH access token in
  `X-KH-Acting-Token`.
  - KH verifies the RU token like any other: signature, issuer, audience and expiry.
  - The token must carry an e-mail, and that e-mail must not be marked unverified.
  - KH takes the RU from the token's e-mail. An e-mail the agent merely writes is never read.
  - A bad RU token gets 401.
  - A header sent by anyone without the permission is ignored.
- **Other sign-in services** (fen 2026-10-20, for the Ticketing chatbot whose users sign in to its own
  realm). `KH_ACTING_ISSUERS` is a JSON list of `{issuer, audience, technical_users, jwks_uri?}`.
  - Only the TUs listed for an issuer may pass that issuer's tokens.
  - Such a token needs `email_verified: true`.
  - A change needs `cf restart`, not a rebuild.
- **Write.** A worklog written this way gets `metadata.acting_user = <RU e-mail>`. The server sets it
  from the token only; a value in the request body is dropped.
- **Read.** A keyed worklog is read only by:
  - the TU acting for the same RU;
  - the RU signed in as themselves;
  - a maintainer.

  Everyone else, including the TU with no header, sees only unkeyed rows. This covers `/log/recent`
  (both the project read and the caller's own window, filtered before the page is cut),
  `/vector/scroll`, `/vector/topics`, `/vector/query` (filtered before the top k is cut) and
  `/context/step`.
- **Shared summaries.** The daily listing and summaries (`/log/day`, `/log/week`) leave keyed rows out.
- **Worklogs only.** Knowledge and findings are not keyed.

## kh-helper 1.16.0

- `KH_ACTING_TOKEN` (the token) or `KH_ACTING_TOKEN_FILE` (a file read on every call, so the agent can
  refresh it) adds the header to every KH call.
- The auto worklog hands the RU token to its worker on stdin, as it does with the access token. The token
  is never written to disk.
- A job whose RU token is gone is dropped. It is never stored unkeyed, because an unkeyed row would be
  visible to every member.

## Code

- `app/auth.py`: `ACT_FOR_USER`, `acting_email`, `acting_key`, `acting_visible`, and the `row_visible`
  change. The middleware reads the header.
- `main.py`: the write stamp and the `/log/recent` filter.
- `app/retriever.py`, `app/caps/daily.py`.
- `tools/kh-helper/kh_helper/session.py`, `worklog.py`.
- Tests: `tests/test_acting_user.py` (57 checks) and `tests/test_kh_helper_worklog.py` (+3).

## Turning it on for an account

1. Run `seed.py` once with the new catalog.
2. Create the realm role `technical-user`.
3. Give the role directly to the TU account (never through a group).
4. Grant the TU project levels the ordinary way.
5. The agent obtains each RU's KH access token, for example through RU sign-in on the agent's front end,
   and passes it along.
