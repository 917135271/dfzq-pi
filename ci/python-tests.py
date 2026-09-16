"""Use the service-owned offline allowlist and emit Jenkins JUnit results."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[1] / "services/audit-ai"
spec = importlib.util.spec_from_file_location("audit_service", root / "service.py")
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)
raise SystemExit(subprocess.call([
    os.environ.get("DFZQ_AUDIT_AI_PYTHON", sys.executable), str(root / "service.py"),
    "test", *service.TESTS, "--junitxml=" + sys.argv[1],
]))
