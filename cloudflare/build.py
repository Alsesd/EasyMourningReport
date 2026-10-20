#!/usr/bin/env python3
"""Stage the live app into a self-contained Cloudflare project bundle."""
from pathlib import Path
import shutil
import subprocess
import sys

CLOUDFLARE_DIR = Path(__file__).resolve().parent
ROOT = CLOUDFLARE_DIR.parent
BUILD = CLOUDFLARE_DIR / "_build"


def main() -> None:
    if BUILD.exists():
        shutil.rmtree(BUILD)
    BUILD.mkdir(parents=True)
    shutil.copytree(ROOT / "app", BUILD / "app")
    shutil.copytree(ROOT / "src", BUILD / "src")
    scripts = BUILD / "scripts"
    scripts.mkdir()
    shutil.copy2(ROOT / "scripts" / "bundle_templates.py", scripts / "bundle_templates.py")
    subprocess.run(
        [sys.executable, str(scripts / "bundle_templates.py")],
        cwd=BUILD,
        check=True,
    )
    print(f"Cloudflare bundle staged at {BUILD}")


if __name__ == "__main__":
    main()
