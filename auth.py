"""Accounts: password hashing, users, server-side sessions and sign-in lockout.

Passwords are hashed with scrypt (per-user salt). Session tokens are 256-bit random values;
only their SHA-256 hash is stored, so a copy of the database can't be used to sign in.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone

import database

PASSWORD_MIN = 8
PASSWORD_MAX = 128
EMAIL_MAX = 254
DISPLAY_NAME_MAX = 60

# scrypt cost. N=2**15 takes ~60 ms here; tests lower it. Parameters are stored in each hash,
# so raising them later still verifies old hashes.
SCRYPT_N = 2 ** 15
SCRYPT_R = 8
SCRYPT_P = 1
_SCRYPT_MAXMEM = 128 * 1024 * 1024

DEMO_EMAIL = "demo@cartchef.invalid"

_EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$")
_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")

# Very common passwords (lower-cased) that pass the length rule but are guessed first.
COMMON_PASSWORDS = frozenset("""
password password1 password12 password123 password1234 passw0rd p@ssw0rd p@ssword
12345678 123456789 1234567890 0123456789 87654321 11111111 00000000 12341234 11223344
qwertyui qwertyuiop qwerty123 qwerty12 1q2w3e4r 1q2w3e4r5t zaq12wsx asdfghjk asdfasdf
iloveyou iloveyou1 sunshine princess football baseball welcome1 welcome123 letmein1
letmein123 trustno1 superman batman123 dragon123 monkey123 shadow123 master123 abc12345
abcd1234 abcdefgh aaaaaaaa changeme changeme1 administrator admin123 admin1234 secret123
computer internet starwars whatever freedom1 1qaz2wsx michael1 jennifer charlie1
cartchef cartchef1 cartchef123 recipes1 shopping1 cooking1 chefchef
""".split())


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def sql_time(moment: datetime) -> str:
    """The format SQLite's CURRENT_TIMESTAMP uses, so stored times compare as text."""
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------

def normalize_email(value) -> str:
    return value.strip().lower() if isinstance(value, str) else ""


def email_error(email: str) -> str | None:
    if not email:
        return "Enter your email address."
    if len(email) > EMAIL_MAX or not _EMAIL_RE.match(email):
        return "Enter a valid email address, like name@example.com."
    return None


def password_error(password, email: str = "") -> str | None:
    """Length and common-password rules only; no arbitrary composition rules."""
    if not isinstance(password, str) or not password:
        return "Choose a password."
    if len(password) < PASSWORD_MIN:
        return f"Use at least {PASSWORD_MIN} characters."
    if len(password) > PASSWORD_MAX:
        return f"Use {PASSWORD_MAX} characters or fewer."
    lowered = password.lower()
    if lowered in COMMON_PASSWORDS or (email and lowered == email.split("@")[0]) or len(set(password)) < 3:
        return "That password is too easy to guess. Try a few unrelated words together."
    return None


def clean_display_name(value, email: str) -> str:
    name = " ".join(_CONTROL_RE.sub("", value).split()) if isinstance(value, str) else ""
    if not name:
        local = email.split("@")[0]
        name = " ".join(part for part in re.split(r"[._+-]+", local) if part).title() or local
    return name[:DISPLAY_NAME_MAX]


# --------------------------------------------------------------------------
# Password hashing
# --------------------------------------------------------------------------

def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P,
                            maxmem=_SCRYPT_MAXMEM, dklen=32)
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt, expected = stored.split("$")
        if scheme != "scrypt":
            return False
        digest = hashlib.scrypt(password.encode("utf-8"), salt=base64.b64decode(salt), n=int(n), r=int(r),
                                p=int(p), maxmem=_SCRYPT_MAXMEM, dklen=32)
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest, base64.b64decode(expected))


_dummy_hash: str | None = None


def burn_password_check(password: str) -> None:
    """Spend the same time as a real check, so unknown emails can't be told apart by timing."""
    global _dummy_hash
    if _dummy_hash is None or f"${SCRYPT_N}$" not in _dummy_hash:
        _dummy_hash = hash_password(secrets.token_hex(8))
    verify_password(password, _dummy_hash)


# --------------------------------------------------------------------------
# Users
# --------------------------------------------------------------------------

def public_user(row: sqlite3.Row) -> dict:
    """What the browser may know about the signed-in user. Never the hash."""
    words = row["display_name"].split()
    initials = "".join(word[0] for word in words[:2]).upper() or row["email"][0].upper()
    return {
        "id": row["id"],
        "email": row["email"],
        "display_name": row["display_name"],
        "initials": initials,
        "is_demo": bool(row["is_demo"]),
        "created_at": row["created_at"],
    }


def get_user(conn: sqlite3.Connection, user_id: int) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def find_user(conn: sqlite3.Connection, email: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()


def create_user(conn: sqlite3.Connection, email: str, password_hash: str, display_name: str, *,
                is_demo: bool = False, seed: bool = True) -> int:
    """Insert a user (and their own starter recipes). Raises sqlite3.IntegrityError on a taken email."""
    cursor = conn.execute(
        "INSERT INTO users (email, password_hash, display_name, is_demo) VALUES (?, ?, ?, ?)",
        (email, password_hash, display_name, int(is_demo)),
    )
    user_id = cursor.lastrowid
    if seed:
        database.seed_recipes(conn, user_id)
    return user_id


def delete_user(conn: sqlite3.Connection, user_id: int) -> None:
    """Delete a user. Foreign keys cascade to their recipes, list, plan, events and sessions."""
    conn.execute("DELETE FROM users WHERE id = ?", (user_id,))


def reset_user_data(conn: sqlite3.Connection, user_id: int, *, seed: bool = True) -> None:
    """Empty a user's box, list, plan and history (the shared demo's daily reset)."""
    for table in ("meal_plan", "shopping_list", "events", "recipes"):
        conn.execute(f"DELETE FROM {table} WHERE user_id = ?", (user_id,))  # constant table names
    if seed:
        database.seed_recipes(conn, user_id)


# --------------------------------------------------------------------------
# Sessions
# --------------------------------------------------------------------------

def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(conn: sqlite3.Connection, user_id: int, days: int, *, remember: bool) -> tuple[str, datetime]:
    """Start a session. Returns the raw token (for the cookie only) and when it expires."""
    purge_expired(conn)
    token = secrets.token_urlsafe(32)  # 256 bits
    expires = utcnow() + timedelta(days=days)
    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, remember, expires_at) VALUES (?, ?, ?, ?)",
        (token_hash(token), user_id, int(remember), sql_time(expires)),
    )
    conn.execute("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?", (user_id,))
    return token, expires


def load_session(conn: sqlite3.Connection, token: str | None) -> sqlite3.Row | None:
    """The live session for a cookie token (joined with its user), or None.

    An expired session found here is deleted. last_seen is refreshed at most every 5 minutes.
    """
    if not token or len(token) > 128:
        return None
    row = conn.execute(
        """SELECT sessions.id AS session_id, sessions.token_hash, sessions.expires_at, sessions.last_seen, users.*
           FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ?""",
        (token_hash(token),),
    ).fetchone()
    if row is None:
        return None
    now = utcnow()
    if row["expires_at"] <= sql_time(now):
        conn.execute("DELETE FROM sessions WHERE id = ?", (row["session_id"],))
        conn.commit()
        return None
    if row["last_seen"] < sql_time(now - timedelta(minutes=5)):
        conn.execute("UPDATE sessions SET last_seen = ? WHERE id = ?", (sql_time(now), row["session_id"]))
        conn.commit()
    return row


def end_session(conn: sqlite3.Connection, token: str | None) -> None:
    if token:
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash(token),))


def purge_expired(conn: sqlite3.Connection) -> None:
    now = sql_time(utcnow())
    conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
    conn.execute("DELETE FROM auth_failures WHERE created_at <= datetime(?, '-1 day')", (now,))


def csrf_for(secret: str, session_hash: str) -> str:
    """The CSRF token of a signed-in session: derived, so it needs no storage and dies with the session."""
    return hmac.new(secret.encode("utf-8"), f"csrf:{session_hash}".encode(), hashlib.sha256).hexdigest()


def analytics_id(secret: str, user_id: int) -> str:
    """Salted, non-reversible id for analytics (BigQuery). Never the email or the raw id."""
    return hmac.new(secret.encode("utf-8"), f"analytics:{user_id}".encode(), hashlib.sha256).hexdigest()[:32]


# --------------------------------------------------------------------------
# Failed sign-in lockout
# --------------------------------------------------------------------------

def failure_keys(secret: str, email: str, client: str) -> tuple[str, str]:
    """Hashed keys for failures by this email from this client, and by this email from anywhere."""
    def key(text: str) -> str:
        return hmac.new(secret.encode("utf-8"), text.encode("utf-8"), hashlib.sha256).hexdigest()
    return key(f"pair:{email}|{client}"), key(f"email:{email}")


def recent_failures(conn: sqlite3.Connection, key: str, minutes: int) -> int:
    since = sql_time(utcnow() - timedelta(minutes=minutes))
    return conn.execute(
        "SELECT COUNT(*) FROM auth_failures WHERE key = ? AND created_at > ?", (key, since)
    ).fetchone()[0]


def record_failure(conn: sqlite3.Connection, *keys: str) -> None:
    now = sql_time(utcnow())
    conn.executemany("INSERT INTO auth_failures (key, created_at) VALUES (?, ?)", [(k, now) for k in keys])


def clear_failures(conn: sqlite3.Connection, key: str) -> None:
    conn.execute("DELETE FROM auth_failures WHERE key = ?", (key,))
