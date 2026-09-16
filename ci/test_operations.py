"""Operational regressions with temporary Git repos and inert Docker/SSH commands."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1]


class OperationsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.env = {**os.environ, "MAIN_REF": "main", "BRANCH_NAME": "dfzq/intranet", "CHANGE_ID": "", "DFZQ_REGISTRY": "local"}
        self.git("init", "-b", "main")
        self.git("config", "user.name", "test")
        self.git("config", "user.email", "test@example.invalid")
        (self.root / "product.txt").write_text("main\n")
        self.git("add", "product.txt")
        self.git("commit", "-qm", "baseline")
        self.git("switch", "-c", "dfzq/intranet")
        shutil.copytree(SOURCE / "ci", self.root / "ci", ignore=shutil.ignore_patterns("out", "__pycache__"))
        shutil.copytree(SOURCE / "deploy", self.root / "deploy", ignore=shutil.ignore_patterns(".env", "config"))
        shutil.copy2(SOURCE / "Jenkinsfile", self.root / "Jenkinsfile")
        self.git("add", "ci", "deploy", "Jenkinsfile")
        self.git("commit", "-qm", "operations")
        self.rev = self.git("rev-parse", "HEAD").stdout.strip()
        self.out = self.root / "ci/out"
        self.out.mkdir()
        self.bin = self.out / "bin"
        self.bin.mkdir()
        for command in ["docker", "ssh"]:
            p = self.bin / command
            p.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$COMMAND_LOG"\n')
            p.chmod(0o755)
        self.log = self.out / "commands"
        self.env.update(PATH=str(self.bin) + os.pathsep + os.environ["PATH"], COMMAND_LOG=str(self.log))

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.root, capture_output=True, text=True, check=True)

    def run_script(self, script, *args):
        return subprocess.run(["bash", script, *args], cwd=self.root, env=self.env, capture_output=True, text=True, timeout=20)

    def receipts(self):
        for name in ["tested", "rehearsed", "published"]:
            (self.out / name).write_text(self.rev + "\n")

    def test_parity_accepts_only_ops_additions(self):
        self.assertEqual(self.run_script("ci/check-main.sh").returncode, 0)
        (self.root / "product.txt").write_text("different\n")
        self.git("add", "product.txt")
        self.git("commit", "-qm", "drift")
        result = self.run_script("ci/check-main.sh")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Non-operational", result.stderr)

    def test_stale_main_is_rejected(self):
        self.git("switch", "main")
        (self.root / "product.txt").write_text("new main\n")
        self.git("add", "product.txt")
        self.git("commit", "-qm", "advance main")
        self.git("switch", "dfzq/intranet")
        self.assertNotEqual(self.run_script("ci/check-main.sh").returncode, 0)

    def test_branch_and_pr_cannot_publish(self):
        self.receipts()
        for branch, change in [("main", ""), ("evil/dfzq/intranet", ""), ("dfzq/intranet", "12")]:
            self.env.update(BRANCH_NAME=branch, CHANGE_ID=change)
            self.assertNotEqual(self.run_script("ci/publish.sh").returncode, 0)
            self.assertFalse(self.log.exists())

    def test_publish_requires_current_receipts(self):
        self.assertNotEqual(self.run_script("ci/publish.sh").returncode, 0)
        self.receipts()
        (self.out / "rehearsed").write_text("old\n")
        self.assertNotEqual(self.run_script("ci/publish.sh").returncode, 0)
        self.assertFalse(self.log.exists())

    def test_publish_exact_revision(self):
        self.receipts()
        result = self.run_script("ci/publish.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.log.read_text(), "push local/dfzq-pi:" + self.rev + "\n")

    def test_build_dry_run_has_no_docker_effects(self):
        result = self.run_script("deploy/build.sh", "--test", "--dry-run")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Dockerfile.base", result.stdout)
        self.assertIn(self.rev, result.stdout)
        self.assertNotIn("git clone", result.stdout)
        self.assertFalse(self.log.exists())

    def test_deploy_rejects_shell_metacharacters_before_ssh(self):
        self.receipts()
        self.env.update(DFZQ_DEPLOY_HOST="host", DFZQ_DEPLOY_DIR="/tmp/x;touch /tmp/pwn", SSH_KEY="key", DFZQ_NO_PROD_DEPLOY="0")
        self.assertNotEqual(self.run_script("ci/deploy.sh").returncode, 0)
        self.assertFalse(self.log.exists())

    def test_cleanup_without_owned_rehearsal_is_inert(self):
        self.assertEqual(self.run_script("ci/rehearsal-down.sh").returncode, 0)
        self.assertFalse(self.log.exists())


if __name__ == "__main__":
    unittest.main()
