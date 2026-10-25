"""Tests for the Corvus key operator tool, on temporary directories owned by
the current user (no sudo, no real Corvus files).

Run inside server/:  npm run test:dict
"""

import hashlib
import os
import pwd
import subprocess
import sys
import tempfile
import unittest

TOOL = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "aiExamples", "ops", "corvus_key.py")
ME = pwd.getpwuid(os.getuid()).pw_name


def run(*args):
    env = {k: v for k, v in os.environ.items() if k != "SUDO_UID"}
    return subprocess.run([sys.executable, "-I", TOOL, *args], capture_output=True, text=True, env=env)


def read(path):
    with open(path) as f:
        return f.read()


def digest_of(path):
    return hashlib.sha256(read(path).strip().encode("ascii")).hexdigest()


class KeyToolTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = self.tmp.name
        self.keys = os.path.join(root, "keys")
        os.mkdir(self.keys, 0o700)
        self.allow = os.path.join(self.keys, "keys.sha256")
        self.existing = [hashlib.sha256(b"operator-key-%d" % i).hexdigest() for i in range(2)]
        with open(self.allow, "w") as f:
            f.write("\n".join(self.existing) + "\n")
        os.chmod(self.allow, 0o600)
        self.backups = os.path.join(root, "keys-backup")
        self.client = os.path.join(root, "secrets", "corvus_api_key")

    def tearDown(self):
        self.tmp.cleanup()

    def tool(self, action, *extra):
        return run(action, "--key-file", self.client, "--keys-dir", self.keys, "--service-user", ME,
                   "--backup-dir", self.backups, *extra)

    def allowlist(self):
        with open(self.allow, "rb") as f:
            return f.read()

    def test_create_never_overwrites(self):
        r = run("create", "--key-file", self.client)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn(read(self.client).strip(), r.stdout)  # key not printed
        self.assertEqual(os.stat(self.client).st_mode & 0o777, 0o600)
        self.assertEqual(os.stat(os.path.dirname(self.client)).st_mode & 0o777, 0o700)
        before = read(self.client)
        r2 = run("create", "--key-file", self.client)
        self.assertEqual(r2.returncode, 1)
        self.assertIn("not overwritten", r2.stderr)
        self.assertEqual(read(self.client), before)

    def test_check_changes_nothing(self):
        run("create", "--key-file", self.client)
        before = self.allowlist()
        r = self.tool("add", "--check")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("check only: add: 2 -> 3 keys", r.stdout)
        self.assertEqual(self.allowlist(), before)
        self.assertFalse(os.path.exists(self.backups))

    def test_add_backs_up_and_keeps_existing_keys(self):
        run("create", "--key-file", self.client)
        before = self.allowlist()
        r = self.tool("add")
        self.assertEqual(r.returncode, 0, r.stderr)
        lines = self.allowlist().decode().splitlines()
        self.assertEqual(lines, self.existing + [digest_of(self.client)])
        st = os.stat(self.allow)
        self.assertEqual((st.st_mode & 0o777, st.st_nlink, st.st_uid), (0o600, 1, os.getuid()))
        saved = [os.path.join(self.backups, n) for n in os.listdir(self.backups)]
        self.assertEqual(len(saved), 1)
        with open(saved[0], "rb") as f:
            self.assertEqual(f.read(), before)
        self.assertEqual(os.stat(saved[0]).st_mode & 0o777, 0o600)
        self.assertEqual(os.stat(self.backups).st_mode & 0o777, 0o700)
        self.assertFalse(any(n.endswith(".new") for n in os.listdir(self.keys)))
        again = self.tool("add")
        self.assertIn("already installed", again.stdout)
        self.assertEqual(len(os.listdir(self.backups)), 1)

    def test_remove_only_ours_and_never_the_last(self):
        run("create", "--key-file", self.client)
        self.tool("add")
        r = self.tool("remove")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.allowlist().decode().splitlines(), self.existing)
        # only key left is ours: refuse
        with open(self.allow, "w") as f:
            f.write(digest_of(self.client) + "\n")
        r2 = self.tool("remove")
        self.assertEqual(r2.returncode, 1)
        self.assertIn("only key", r2.stderr)

    def assertRefused(self, *expect):
        before = self.allowlist() if not os.path.islink(self.allow) else None
        r = self.tool("add")
        self.assertEqual(r.returncode, 1, r.stdout)
        for e in expect:
            self.assertIn(e, r.stderr)
        if before is not None:
            self.assertEqual(self.allowlist(), before)

    def test_refusals_leave_everything_unchanged(self):
        run("create", "--key-file", self.client)
        with open(self.allow, "w") as f:  # a blank line is invalid for Corvus
            f.write(self.existing[0] + "\n\n" + self.existing[1] + "\n")
        self.assertRefused("not a valid allowlist")
        with open(self.allow, "w") as f:
            f.write(self.existing[0].upper() + "\n")
        self.assertRefused("not a valid allowlist")
        with open(self.allow, "w") as f:
            f.write("\n".join(self.existing) + "\n")
        os.chmod(self.allow, 0o644)
        self.assertRefused("0600")
        os.chmod(self.allow, 0o600)
        os.chmod(self.keys, 0o755)
        self.assertRefused("0700")
        os.chmod(self.keys, 0o700)
        open(os.path.join(self.keys, ".keys.sha256.new"), "w").close()
        self.assertRefused("earlier run")
        os.remove(os.path.join(self.keys, ".keys.sha256.new"))
        os.chmod(self.client, 0o644)
        self.assertRefused("mode 0600")
        os.chmod(self.client, 0o600)
        with open(self.allow, "w") as f:
            f.write("\n".join(hashlib.sha256(b"k%d" % i).hexdigest() for i in range(16)) + "\n")
        self.assertRefused("16 keys")

    def test_symlinked_allowlist_is_refused(self):
        run("create", "--key-file", self.client)
        real = os.path.join(self.tmp.name, "elsewhere")
        os.rename(self.allow, real)
        os.symlink(real, self.allow)
        self.assertRefused()
        self.assertTrue(os.path.islink(self.allow))


if __name__ == "__main__":
    unittest.main()
