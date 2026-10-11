"""Build and stage a runnable PyOxidizer distribution.

Usage:
    poetry run python build.py
    poetry run python build.py --debug
    poetry run python build.py --target-triple x86_64-pc-windows-msvc

The complete install tree is copied to dist/, not just the executable: PyOxidizer
places filesystem-relative Python resources and application assets alongside it.
"""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST_DIR = ROOT / "dist"
BUILD_DIR = ROOT / "build"
CONFIG_FILE = ROOT / "pyoxidizer.bzl"


def get_pyoxidizer_cmd() -> list[str]:
    """Find the PyOxidizer CLI without hiding its eventual error output."""
    executable = shutil.which("pyoxidizer")
    if executable:
        return [executable]
    return ["pyoxidizer"]


def _executable_name(target_triple: str | None) -> str:
    """Choose the output filename based on the requested target OS."""
    target = (target_triple or "").lower()
    windows_target = "windows" in target or "mingw" in target or (
        not target and sys.platform == "win32"
    )
    return "LegkyiZvit.exe" if windows_target else "LegkyiZvit"


def _find_built_executable(name: str) -> Path | None:
    """Prefer the PyOxidizer install manifest, then fall back to any built copy."""
    if not BUILD_DIR.exists():
        return None
    candidates = sorted(BUILD_DIR.glob(f"**/install/{name}"))
    if not candidates:
        candidates = sorted(BUILD_DIR.glob(f"**/{name}"))
    return candidates[0] if candidates else None


def _copy_distribution(executable: Path) -> Path:
    """Stage the executable and every sibling resource into dist/."""
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    source_dir = executable.parent
    target_executable = DIST_DIR / executable.name

    # The default install target produces a complete install directory. Copy
    # its contents together so lib/, templates, and static files aren't lost.
    if source_dir.name.lower() == "install":
        for item in source_dir.iterdir():
            target = DIST_DIR / item.name
            if item.is_dir():
                shutil.copytree(item, target, dirs_exist_ok=True)
            else:
                shutil.copy2(item, target)
    else:
        shutil.copy2(executable, target_executable)
        # A fallback executable path may still have resources in a sibling lib/.
        lib_dir = source_dir / "lib"
        if lib_dir.is_dir():
            shutil.copytree(lib_dir, DIST_DIR / "lib", dirs_exist_ok=True)

    if not target_executable.is_file():
        raise FileNotFoundError(f"Expected executable was not staged at {target_executable}")
    for relative in ("lib/app/templates", "lib/app/static"):
        if not (DIST_DIR / relative).is_dir():
            raise FileNotFoundError(
                f"Missing runtime assets: {DIST_DIR / relative}. "
                "The PyOxidizer install manifest must include templates and static files."
            )
    return target_executable


def build(release: bool = True, target_triple: str | None = None) -> int:
    cmd = get_pyoxidizer_cmd() + ["build"]
    if release:
        cmd.append("--release")
    if target_triple:
        cmd.extend(["--target-triple", target_triple])

    print("Building standalone executable with PyOxidizer...", flush=True)
    print(f"Command: {' '.join(cmd)}", flush=True)
    print(f"Config: {CONFIG_FILE}", flush=True)

    try:
        result = subprocess.run(cmd, cwd=ROOT, check=False)
    except FileNotFoundError:
        print(
            "ERROR: PyOxidizer was not found. Install a compatible PyOxidizer CLI "
            "and ensure it is available in PATH.",
            file=sys.stderr,
        )
        return 1
    if result.returncode:
        print(f"PyOxidizer build failed with code {result.returncode}", file=sys.stderr)
        return result.returncode

    name = _executable_name(target_triple)
    executable = _find_built_executable(name)
    if executable is None:
        print(
            f"ERROR: PyOxidizer returned success but {name} was not found under {BUILD_DIR}.",
            file=sys.stderr,
        )
        return 1

    try:
        target = _copy_distribution(executable)
    except (OSError, FileNotFoundError) as exc:
        print(f"ERROR: Could not stage a runnable distribution: {exc}", file=sys.stderr)
        return 1

    print(f"Successfully packaged runnable distribution: {target}", flush=True)
    print("Keep the lib/ directory next to the executable; it contains runtime modules and assets.", flush=True)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Build LegkyiZvit with PyOxidizer")
    parser.add_argument("--debug", action="store_true", help="Build in debug mode instead of release")
    parser.add_argument("--target-triple", type=str, default=None, help="Target triple for PyOxidizer")
    args = parser.parse_args()
    return build(release=not args.debug, target_triple=args.target_triple)


if __name__ == "__main__":
    sys.exit(main())
