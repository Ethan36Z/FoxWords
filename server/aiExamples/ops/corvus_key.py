"""Provision the FoxWords key for Corvus API v1 (operator tool).

  # 1. As yourself: create the private client key file (never printed).
  python3 -I corvus_key.py create --key-file ~/srv/secrets/foxwords/corvus_api_key

  # 2. With sudo: check first (changes nothing), then add its digest.
  sudo python3 -I corvus_key.py add --key-file ~/srv/secrets/foxwords/corvus_api_key --check
  sudo python3 -I corvus_key.py add --key-file ~/srv/secrets/foxwords/corvus_api_key

  # Revoke later (other keys stay):
  sudo python3 -I corvus_key.py remove --key-file ~/srv/secrets/foxwords/corvus_api_key

Safety rules, matching Corvus' own check (app/api_auth.py):
  - The allowlist directory must be a real directory owned by the service
    user with mode 0700. The allowlist must be a regular file, not a
    symlink, with one link, owned by the service user, mode 0600, and at
    most 2048 bytes. It holds 1-16 unique lowercase SHA-256 digests, one
    per line.
  - Nothing is changed when any check fails. The tool never overwrites a
    key file, never removes another key, and never removes the last key.
  - Before a change, the current allowlist is copied to a root-only backup
    folder (default: <keys-dir>-backup, mode 0700), one file per change.
  - The new allowlist is written to a fresh file in the same directory
    (exclusive create, 0600, service owner), synced, then renamed over the
    old one. Corvus re-reads the file on every request; no restart.
  - Afterwards the file is read back and checked again: all earlier
    digests are present, plus (or minus) exactly the FoxWords one.
"""

import argparse
import datetime
import hashlib
import os
import pwd
import re
import secrets
import stat
import sys

KEYS_DIR = "/var/lib/corvus-text-api/keys"
KEYS_NAME = "keys.sha256"
SERVICE_USER = "corvus-text-api"
KEY_RE = re.compile(r"^[A-Za-z0-9_-]{43,128}$")
DIGEST_RE = re.compile(r"^[0-9a-f]{64}$")
NOFOLLOW = os.O_NOFOLLOW | os.O_CLOEXEC


class Refused(Exception):
    pass


def invoking_uid():
    """The real user behind sudo, who owns the client key file."""
    return int(os.environ.get("SUDO_UID", os.getuid()))


def create_key(path):
    path = os.path.abspath(os.path.expanduser(path))
    parent = os.path.dirname(path)
    if not os.path.isdir(parent):
        os.makedirs(parent, mode=0o700)
    st = os.lstat(parent)
    if stat.S_ISLNK(st.st_mode) or st.st_uid != os.getuid() or stat.S_IMODE(st.st_mode) != 0o700:
        raise Refused(f"{parent} must be your own directory with mode 0700")
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | NOFOLLOW, 0o600)
    except FileExistsError:
        raise Refused(f"{path} already exists; it is not overwritten") from None
    with os.fdopen(fd, "w") as f:
        f.write(secrets.token_urlsafe(32) + "\n")
        f.flush()
        os.fsync(f.fileno())
    return path


def read_client_key(path):
    path = os.path.abspath(os.path.expanduser(path))
    fd = os.open(path, os.O_RDONLY | NOFOLLOW)
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_uid != invoking_uid() or stat.S_IMODE(st.st_mode) != 0o600:
            raise Refused(f"{path} must be a regular file owned by you with mode 0600")
        key = os.read(fd, 4096).decode("ascii").strip()
    finally:
        os.close(fd)
    if not KEY_RE.match(key):
        raise Refused(f"{path} does not hold a valid key")
    return hashlib.sha256(key.encode("ascii")).hexdigest()


def read_allowlist(keys_dir, owner_uid):
    """Same checks as Corvus. Returns (digests, raw bytes)."""
    dfd = os.open(keys_dir, os.O_RDONLY | os.O_DIRECTORY | NOFOLLOW)
    try:
        d = os.fstat(dfd)
        if d.st_uid != owner_uid or stat.S_IMODE(d.st_mode) != 0o700:
            raise Refused(f"{keys_dir} must be owned by the service user with mode 0700")
        fd = os.open(KEYS_NAME, os.O_RDONLY | NOFOLLOW, dir_fd=dfd)
        try:
            st = os.fstat(fd)
            if (not stat.S_ISREG(st.st_mode) or st.st_nlink != 1 or st.st_uid != owner_uid
                    or stat.S_IMODE(st.st_mode) != 0o600):
                raise Refused(f"{KEYS_NAME} must be a regular 0600 file owned by the service user, one link")
            raw = os.read(fd, 2049)
        finally:
            os.close(fd)
    finally:
        os.close(dfd)
    if len(raw) > 2048:
        raise Refused(f"{KEYS_NAME} is larger than 2048 bytes")
    digests = raw.decode("ascii").splitlines()
    if not 1 <= len(digests) <= 16 or len(set(digests)) != len(digests) or not all(DIGEST_RE.match(x) for x in digests):
        raise Refused(f"{KEYS_NAME} is not a valid allowlist; fix it by hand first")
    return digests, raw


def backup(raw, backup_dir):
    if not os.path.isdir(backup_dir):
        os.makedirs(backup_dir, mode=0o700)
    st = os.lstat(backup_dir)
    if stat.S_ISLNK(st.st_mode) or st.st_uid != os.geteuid() or stat.S_IMODE(st.st_mode) != 0o700:
        raise Refused(f"{backup_dir} must be a 0700 directory owned by {os.geteuid()}")
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    path = os.path.join(backup_dir, f"{KEYS_NAME}.{stamp}")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | NOFOLLOW, 0o600)
    try:
        os.write(fd, raw)
        os.fsync(fd)
    finally:
        os.close(fd)
    return path


def replace_allowlist(keys_dir, digests, owner_uid, owner_gid):
    body = ("\n".join(digests) + "\n").encode("ascii")
    if len(body) > 2048:
        raise Refused("new allowlist would exceed 2048 bytes")
    dfd = os.open(keys_dir, os.O_RDONLY | os.O_DIRECTORY | NOFOLLOW)
    tmp = f".{KEYS_NAME}.new"
    try:
        try:
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | NOFOLLOW, 0o600, dir_fd=dfd)
        except FileExistsError:
            raise Refused(f"{keys_dir}/{tmp} exists (an earlier run stopped?); check it and remove it by hand") from None
        try:
            os.write(fd, body)
            os.fchown(fd, owner_uid, owner_gid)
            os.fchmod(fd, 0o600)
            os.fsync(fd)
        finally:
            os.close(fd)
        os.rename(tmp, KEYS_NAME, src_dir_fd=dfd, dst_dir_fd=dfd)
        os.fsync(dfd)
    finally:
        os.close(dfd)


def change(action, key_file, keys_dir, service_user, backup_dir, check):
    owner = pwd.getpwnam(service_user)
    digest = read_client_key(key_file)
    before, raw = read_allowlist(keys_dir, owner.pw_uid)
    if action == "add":
        if digest in before:
            return "already installed; nothing changed"
        if len(before) >= 16:
            raise Refused("the allowlist already has 16 keys")
        after = before + [digest]
    else:
        if digest not in before:
            return "not installed; nothing changed"
        if len(before) == 1:
            raise Refused("this is the only key; removing it would disable the API for every client")
        after = [d for d in before if d != digest]
    plan = f"{action}: {len(before)} -> {len(after)} keys; other keys unchanged"
    if check:
        return f"check only: {plan}"
    saved = backup(raw, backup_dir)
    replace_allowlist(keys_dir, after, owner.pw_uid, owner.pw_gid)
    now, _ = read_allowlist(keys_dir, owner.pw_uid)
    kept = set(before) - {digest}
    if not kept <= set(now) or (digest in now) != (action == "add") or len(now) != len(after):
        raise Refused(f"verification failed; restore from {saved}")
    return f"{plan}; backup: {saved}"


def main(argv):
    p = argparse.ArgumentParser(description="Provision the FoxWords key for Corvus API v1")
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("create")
    c.add_argument("--key-file", required=True)
    for name in ("add", "remove"):
        s = sub.add_parser(name)
        s.add_argument("--key-file", required=True)
        s.add_argument("--keys-dir", default=KEYS_DIR)
        s.add_argument("--service-user", default=SERVICE_USER)
        s.add_argument("--backup-dir", default=None)
        s.add_argument("--check", action="store_true", help="validate and report; change nothing")
    a = p.parse_args(argv)
    try:
        if a.cmd == "create":
            print("created", create_key(a.key_file), "(mode 0600; the key is not shown)")
        else:
            backup_dir = a.backup_dir or a.keys_dir.rstrip("/") + "-backup"
            print(change(a.cmd, a.key_file, a.keys_dir, a.service_user, backup_dir, a.check))
    except (Refused, OSError, UnicodeError) as err:
        print("refused:", err, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
