"""Shared pytest setup: isolate application data from developer files."""

import os
import tempfile

os.environ.setdefault(
    "LEGKYI_DATA_DIR", tempfile.mkdtemp(prefix="legkyi-zvit-pytest-")
)
os.environ.setdefault("SECRET_KEY", "pytest-only-secret-key-not-for-production")
