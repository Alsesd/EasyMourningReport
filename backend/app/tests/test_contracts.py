"""Replay language-neutral HTTP contract scenarios (testdata/contracts/*.json).

The scenarios are the characterization suite for the planned Go port: the same
files are replayed against any implementation. Each scenario starts from an empty
database that holds only the built-in roles and one platform administrator, then
builds everything else through the API.

Record or refresh expectations from this (Python) implementation with:

    CONTRACTS_RECORD=1 uv run --locked pytest backend/app/tests/test_contracts.py

Format: see testdata/contracts/README.md.
"""

import json
import os
import re
from pathlib import Path

import pytest

os.environ.setdefault("SECRET_KEY", "api-test-session-secret")

from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlmodel import create_engine

from app.core.periods import current_period
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.platform.accounts.testing import make_admin

ROOT = Path(__file__).resolve().parents[3]
SCENARIOS = sorted((ROOT / "testdata" / "contracts").glob("*.json"))
RECORD = os.environ.get("CONTRACTS_RECORD") == "1"
ORIGIN = {"origin": "http://testserver"}
VOLATILE_KEYS = {"ts", "created_at", "last_backup_at"}
PLACEHOLDER = re.compile(r"\{([a-z_][a-z0-9_]*)\}")


def normalise(value):
    if isinstance(value, dict):
        return {k: ("<time>" if k in VOLATILE_KEYS and v is not None else normalise(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [normalise(v) for v in value]
    if value == current_period():  # the server's local current month differs between runs
        return "<current-period>"
    return value


def substitute(value, saved):
    if isinstance(value, str):
        whole = PLACEHOLDER.fullmatch(value)
        if whole and whole.group(1) in saved:
            return saved[whole.group(1)]
        return PLACEHOLDER.sub(lambda m: str(saved[m.group(1)]) if m.group(1) in saved else m.group(0), value)
    if isinstance(value, dict):
        return {k: substitute(v, saved) for k, v in value.items()}
    if isinstance(value, list):
        return [substitute(v, saved) for v in value]
    return value


def dig(data, path):
    for part in path.split("."):
        data = data[int(part)] if isinstance(data, list) else data[part]
    return data


@pytest.fixture
def seeded_engine():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(engine, expire_on_commit=False)

    def override_get_db():
        with Session() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    yield Session
    app.dependency_overrides.clear()
    engine.dispose()


@pytest.mark.parametrize("path", SCENARIOS, ids=lambda p: p.stem)
def test_scenario(path, seeded_engine):
    scenario = json.loads(path.read_text(encoding="utf-8"))
    admin = scenario["seed"]["platform_admin"]
    with seeded_engine() as db:
        make_admin(db, admin["login"], admin["password"])
        db.commit()

    clients: dict[str, TestClient] = {}
    saved: dict[str, object] = {}
    failures = []
    try:
        for index, step in enumerate(scenario["steps"], start=1):
            client = clients.setdefault(step.get("as", "anon"), TestClient(app, follow_redirects=False))
            headers = {} if step.get("no_origin") else dict(ORIGIN)
            kwargs = {"headers": headers}
            if "json" in step:
                kwargs["json"] = substitute(step["json"], saved)
            if "multipart" in step:
                spec = step["multipart"]
                kwargs["files"] = {"file": (spec["filename"], (ROOT / "testdata" / "contracts" / spec["path"]).read_bytes())}
            response = client.request(step["method"], substitute(step["path"], saved), **kwargs)

            actual = {"status": response.status_code}
            ctype = response.headers.get("content-type", "")
            if ctype.startswith("application/json"):
                actual["json"] = normalise(response.json())
            else:
                actual["content_type"] = ctype.split(";")[0]
            for name, field in step.get("save", {}).items():
                saved[name] = dig(response.json(), field)

            if RECORD:
                step["expect"] = actual
            elif step["expect"] != actual:
                failures.append(f"step {index} «{step['name']}»:\n  expected {step['expect']}\n  actual   {actual}")
    finally:
        for client in clients.values():
            client.close()

    if RECORD:
        path.write_text(json.dumps(scenario, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    assert not failures, "\n".join(failures)
