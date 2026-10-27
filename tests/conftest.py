"""Shared pytest setup: isolate application data and manage database configuration."""

import os
import sys
import tempfile

sys.dont_write_bytecode = True

# Configure isolated temp data directory
os.environ.setdefault(
    "LEGKYI_DATA_DIR", tempfile.mkdtemp(prefix="legkyi-zvit-pytest-")
)
os.environ.setdefault("SECRET_KEY", "pytest-only-secret-key-not-for-production")

# If TEST_DATABASE_URL is provided, configure DATABASE_URL for tests
if os.getenv("TEST_DATABASE_URL"):
    os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]
