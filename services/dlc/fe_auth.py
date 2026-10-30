"""Keycloak (OIDC) access-token checks for the default frontend server. Standard library only.

    cfg = AuthConfig.from_env()          # SDLC_AUTH_ISSUER empty -> auth off
    claims = verify(token, cfg)          # raises AuthError

What is checked: RS256 signature against the issuer's JWKS (discovered through
/.well-known/openid-configuration, cached, refetched once on an unknown kid), iss equals
the issuer, exp / nbf with a small leeway, and - when SDLC_AUTH_AUDIENCE is set - that the
audience list or azp contains it. Roles come from realm_access.roles and
resource_access.<client>.roles: 'dlc-admin' -> admin, 'dlc-viewer' (only) -> viewer,
anything else -> member.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import threading
import time
import urllib.request
from typing import Any, Callable, Dict, Optional

LEEWAY_S = 60
JWKS_TTL_S = 600

# DER prefix of DigestInfo for SHA-256 (PKCS#1 v1.5)
_SHA256_PREFIX = bytes.fromhex("3031300d060960864801650304020105000420")


class AuthError(Exception):
    def __init__(self, message: str, status: int = 401):
        super().__init__(message)
        self.status = status


class AuthConfig:
    def __init__(self, issuer: str = "", client_id: str = "dlc-fe", audience: str = "",
                 fetch: Optional[Callable[[str], Dict[str, Any]]] = None):
        self.issuer = (issuer or "").rstrip("/")
        self.client_id = client_id or "dlc-fe"
        self.audience = audience or ""
        self._fetch = fetch or _http_json
        self._lock = threading.Lock()
        self._keys: Dict[str, Dict[str, Any]] = {}
        self._keys_at = 0.0
        self._jwks_uri = ""

    @classmethod
    def from_env(cls, env: Optional[Dict[str, str]] = None) -> "AuthConfig":
        e = os.environ if env is None else env
        return cls(e.get("SDLC_AUTH_ISSUER", ""), e.get("SDLC_AUTH_CLIENT", "dlc-fe"), e.get("SDLC_AUTH_AUDIENCE", ""))

    @property
    def enabled(self) -> bool:
        return bool(self.issuer)

    def public(self) -> Dict[str, Any]:
        return {"enabled": self.enabled, "issuer": self.issuer, "client_id": self.client_id,
                "audience": self.audience}

    # ------------------------------------------------------------ keys
    def _discover(self) -> str:
        if not self._jwks_uri:
            doc = self._fetch(self.issuer + "/.well-known/openid-configuration")
            self._jwks_uri = str(doc.get("jwks_uri") or self.issuer + "/protocol/openid-connect/certs")
        return self._jwks_uri

    def key(self, kid: str) -> Dict[str, Any]:
        with self._lock:
            fresh = time.time() - self._keys_at < JWKS_TTL_S
            if kid in self._keys and fresh:
                return self._keys[kid]
            if not fresh or kid not in self._keys:
                try:
                    jwks = self._fetch(self._discover())
                except Exception as exc:  # noqa: BLE001
                    if kid in self._keys:          # identity provider briefly down: keep the cached key
                        return self._keys[kid]
                    raise AuthError("cannot reach the identity provider: %s" % exc, 503)
                self._keys = {str(k.get("kid")): k for k in jwks.get("keys", []) if k.get("kty") == "RSA"}
                self._keys_at = time.time()
            if kid not in self._keys:
                raise AuthError("token signed with an unknown key")
            return self._keys[kid]


def _http_json(url: str) -> Dict[str, Any]:
    with urllib.request.urlopen(urllib.request.Request(url, headers={"Accept": "application/json"}), timeout=10) as r:
        return json.loads(r.read().decode("utf-8"))


def _b64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _int(b64: str) -> int:
    return int.from_bytes(_b64(b64), "big")


def rs256_ok(signing_input: bytes, sig: bytes, n: int, e: int) -> bool:
    k = (n.bit_length() + 7) // 8
    if len(sig) != k:
        return False
    s = int.from_bytes(sig, "big")
    if s >= n:
        return False
    em = pow(s, e, n).to_bytes(k, "big")
    t = _SHA256_PREFIX + hashlib.sha256(signing_input).digest()
    if k < len(t) + 11:
        return False
    expect = b"\x00\x01" + b"\xff" * (k - len(t) - 3) + b"\x00" + t
    return em == expect


def verify(token: str, cfg: AuthConfig, now: Optional[float] = None) -> Dict[str, Any]:
    if not token:
        raise AuthError("sign in first")
    parts = token.split(".")
    if len(parts) != 3:
        raise AuthError("malformed token")
    try:
        header = json.loads(_b64(parts[0]))
        claims = json.loads(_b64(parts[1]))
        sig = _b64(parts[2])
    except (ValueError, TypeError):
        raise AuthError("malformed token")
    if header.get("alg") != "RS256":
        raise AuthError("unsupported token algorithm")
    jwk = cfg.key(str(header.get("kid") or ""))
    if not rs256_ok((parts[0] + "." + parts[1]).encode("ascii"), sig, _int(jwk["n"]), _int(jwk["e"])):
        raise AuthError("bad token signature")
    t = time.time() if now is None else now
    if str(claims.get("iss") or "").rstrip("/") != cfg.issuer:
        raise AuthError("token from another issuer")
    if "exp" in claims and t > float(claims["exp"]) + LEEWAY_S:
        raise AuthError("token expired")
    if "nbf" in claims and t + LEEWAY_S < float(claims["nbf"]):
        raise AuthError("token not valid yet")
    if cfg.audience:
        aud = claims.get("aud")
        auds = aud if isinstance(aud, list) else [aud] if aud else []
        if cfg.audience not in auds and claims.get("azp") != cfg.audience:
            raise AuthError("token not meant for this application", 403)
    return claims


def roles(claims: Dict[str, Any], client_id: str = "") -> set:
    out = set((claims.get("realm_access") or {}).get("roles") or [])
    for cid, block in (claims.get("resource_access") or {}).items():
        if not client_id or cid == client_id or cid.startswith("dlc"):
            out.update((block or {}).get("roles") or [])
    return out


def user_of(claims: Dict[str, Any], client_id: str = "") -> Dict[str, Any]:
    rs = roles(claims, client_id)
    if "dlc-admin" in rs:
        role = "admin"
    elif "dlc-viewer" in rs and "dlc-user" not in rs:
        role = "viewer"
    else:
        role = "member"
    name = claims.get("preferred_username") or claims.get("name") or claims.get("email") or claims.get("sub")
    return {"id": "kc:" + str(claims.get("sub") or name), "name": str(name), "email": str(claims.get("email") or ""),
            "role": role, "titles": ["*"] if role == "admin" else []}


__all__ = ["AuthConfig", "AuthError", "verify", "roles", "user_of", "rs256_ok"]
