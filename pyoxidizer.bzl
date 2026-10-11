"""PyOxidizer configuration for the standalone LegkyiZvit application.

Python modules and extension modules live in ./lib so modules that need __file__
(e.g. Jinja2/FastAPI integrations) behave like a normal filesystem install.
Persistent data is resolved separately by app.core.paths next to the executable.
"""

def make_exe():
    dist = default_python_distribution()
    policy = dist.make_python_packaging_policy()
    policy.resources_location = "filesystem-relative:lib"
    policy.resources_location_fallback = None

    python_config = dist.make_python_interpreter_config()
    # Execute app/__main__.py. This entry point is part of the app package and is
    # therefore included by read_package_root; a loose run.py is not required.
    python_config.run_module = "app"
    python_config.module_search_paths = ["$ORIGIN/lib"]
    python_config.filesystem_importer = True
    python_config.oxidized_importer = False
    python_config.sys_frozen = True

    target_name = "LegkyiZvit.exe" if "windows" in BUILD_TARGET_TRIPLE else "LegkyiZvit"
    exe = dist.to_python_executable(
        name=target_name,
        packaging_policy=policy,
        config=python_config,
    )

    exe.add_python_resources(
        exe.pip_install([
            "fastapi>=0.115",
            "uvicorn>=0.30",
            "sqlalchemy>=2.0",
            "jinja2>=3.1",
            "python-multipart>=0.0.9",
            "itsdangerous>=2.2",
            "openpyxl>=3.1.5",
        ])
    )
    exe.add_python_resources(exe.read_package_root(path=".", packages=["app"]))

    # Keep runtime assets beside their package module paths. app/main.py and
    # app/core/ui.py resolve these using Path(__file__).parent.
    exe.add_filesystem_relative_files(
        files=[
            ("app/templates", "lib/app/templates"),
            ("app/static", "lib/app/static"),
        ]
    )
    return exe


def make_embedded_resources(exe):
    return exe.to_embedded_resources()


def make_install(exe):
    files = FileManifest()
    files.add_python_resource(".", exe)
    return files


register_target("exe", make_exe)
register_target("resources", make_embedded_resources, depends=["exe"], default_build_script=True)
register_target("install", make_install, depends=["exe"], default=True)

resolve_targets()
