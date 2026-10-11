"""Build script for compiling EasyMourningReport into a standalone executable with PyOxidizer.

Produces a standalone single executable in dist/:
- LegkyiZvit.exe on Windows
- LegkyiZvit on Linux / macOS

Usage:
    python build.py [--release] [--target-triple TRIPLE]
"""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST_DIR = ROOT / "dist"
CONFIG_FILE = ROOT / "pyoxidizer.bzl"


def get_pyoxidizer_cmd() -> list[str]:
    """Find pyoxidizer executable."""
    pyoxidizer_bin = shutil.which("pyoxidizer")
    if pyoxidizer_bin:
        return [pyoxidizer_bin]
    # Check if available as python module
    try:
        subprocess.run(
            [sys.executable, "-m", "pyoxidizer", "--version"],
            check=True,
            capture_output=True,
        )
        return [sys.executable, "-m", "pyoxidizer"]
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ["pyoxidizer"]


def build(release: bool = True, target_triple: str | None = None) -> int:
    DIST_DIR.mkdir(exist_ok=True)
    cmd = get_pyoxidizer_cmd() + ["build"]
    if release:
        cmd.append("--release")
    if target_triple:
        cmd.extend(["--target-triple", target_triple])

    print("Building standalone executable with PyOxidizer...")
    print(f"Command: {' '.join(cmd)}")
    print(f"Config: {CONFIG_FILE}")

    try:
        result = subprocess.run(cmd, cwd=ROOT)
        if result.returncode != 0:
            print("PyOxidizer build failed with code", result.returncode, file=sys.stderr)
            return result.returncode
    except FileNotFoundError:
        print(
            "ERROR: 'pyoxidizer' executable not found in PATH or environment.\n"
            "Install PyOxidizer via:\n"
            "    cargo install pyoxidizer  OR  pip install pyoxidizer\n",
            file=sys.stderr,
        )
        return 1

    # Locate and copy built executable to dist/
    exe_name = "LegkyiZvit.exe" if sys.platform == "win32" else "LegkyiZvit"
    build_dir = ROOT / "build"
    found = list(build_dir.glob(f"**/{exe_name}"))
    if found:
        target = DIST_DIR / exe_name
        shutil.copy2(found[0], target)
        print(f"Successfully packaged: {target}")
    else:
        print(f"Built binary located in {build_dir}")

    return 0


def main():
    parser = argparse.ArgumentParser(description="Build LegkyiZvit with PyOxidizer")
    parser.add_argument(
        "--debug", action="store_true", help="Build in debug mode instead of release"
    )
    parser.add_argument(
        "--target-triple", type=str, default=None, help="Cross-compile target triple"
    )
    args = parser.parse_args()

    return build(release=not args.debug, target_triple=args.target_triple)


if __name__ == "__main__":
    sys.exit(main())
