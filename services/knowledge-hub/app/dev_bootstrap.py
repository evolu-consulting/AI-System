"""DEV ONLY: a static maintainer bearer token for a local dev KH whose sign-in is a real Keycloak realm.

A local Docker dev KH (e.g. kh-dev-f) points KH_AUTH_ISSUER at the production Keycloak realm, so a person
token cannot be obtained non-interactively and the namespace admin routes (PUT /v1/admin/ns/{ns}) cannot be
smoke-tested from a script. With this switch the dev KH also accepts ONE extra bearer token:

    Authorization: Bearer khdev.<KH_DEV_BOOTSTRAP_TOKEN>

as the maintainer KH_DEV_BOOTSTRAP_EMAIL (default dev-admin@kh.local). Everything else (Keycloak tokens, KH
principal tokens, route rules) is unchanged.

OFF BY DEFAULT and refused (logged, stays off) unless ALL of these hold:
  * KH_DEV_BOOTSTRAP=1 and KH_DEV_BOOTSTRAP_TOKEN has at least 32 characters;
  * not on Cloud Foundry (no VCAP_APPLICATION / VCAP_SERVICES / CF_INSTANCE_GUID);
  * the relational store is not prod-like: KH_STORE_BACKEND=sqlite, or HANA with a HANA_SCHEMA other than
    the default KNOWLEDGE_HUB on a host that is not HANA Cloud (*.hanacloud.ondemand.com).
See docs/caps-dev.md, section "Dev bootstrap".
"""
from __future__ import annotations

import hmac
import logging
import os

from app import config

logger = logging.getLogger(__name__)

PREFIX = "khdev."
PROD_SCHEMA = "KNOWLEDGE_HUB"
_state: dict = {}


def _refusal() -> str | None:
    """Why the bootstrap may not run here, or None when it may."""
    if len(os.getenv("KH_DEV_BOOTSTRAP_TOKEN", "")) < 32:
        return "KH_DEV_BOOTSTRAP_TOKEN must have at least 32 characters"
    if any(os.getenv(v) for v in ("VCAP_APPLICATION", "VCAP_SERVICES", "CF_INSTANCE_GUID")):
        return "running on Cloud Foundry"
    if config.STORE_BACKEND == "sqlite":
        return None
    if config.STORE_BACKEND != "hana":
        return f"unknown store backend {config.STORE_BACKEND}"
    if (config.HANA_SCHEMA or "").upper() == PROD_SCHEMA:
        return f"HANA_SCHEMA is the default {PROD_SCHEMA}"
    if "hanacloud.ondemand.com" in (config.HANA_HOST or "").lower():
        return "HANA_HOST is HANA Cloud"
    return None


def active() -> bool:
    """True when the dev token is accepted. Decided once per process (and logged once)."""
    if "on" not in _state:
        on = os.getenv("KH_DEV_BOOTSTRAP", "").strip() == "1"
        if on:
            why = _refusal()
            if why:
                logger.error("dev bootstrap REFUSED (%s); the dev token is not accepted", why)
                on = False
            else:
                logger.warning("dev bootstrap ON: the static dev token signs in as maintainer %s - DEV ONLY",
                               email())
        _state["on"] = on
    return _state["on"]


def email() -> str:
    return os.getenv("KH_DEV_BOOTSTRAP_EMAIL", "dev-admin@kh.local").strip().lower()


def matches(token: str) -> bool:
    if not token.startswith(PREFIX) or not active():
        return False
    return hmac.compare_digest(token[len(PREFIX):].encode(), os.getenv("KH_DEV_BOOTSTRAP_TOKEN", "").encode())


def principal():
    from app.auth import Principal
    # project.log too: a dev box is filled through POST /vector/add (seed, replay of real logs into a new
    # project), and worklog rows need project.log on top of project.write (auth_rules.json log_permission).
    return Principal(email=email(), role="maintainer",
                     every_project=frozenset({"project.read", "project.write", "project.log"}))
