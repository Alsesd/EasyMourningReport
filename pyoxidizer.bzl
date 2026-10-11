"""PyOxidizer configuration for the standalone LegkyiZvit application.

PyOxidizer 0.24 bundles CPython 3.10. Runtime modules and extension modules
are placed in ./lib. Templates and static assets are staged beside the executable.
"""

def make_exe():
    dist = default_python_distribution()
    policy = dist.make_python_packaging_policy()
    policy.resources_location = "filesystem-relative:lib"
    policy.resources_location_fallback = None

    python_config = dist.make_python_interpreter_config()
    python_config.run_module = "app"
    python_config.module_search_paths = ["$ORIGIN/lib"]
    python_config.filesystem_importer = True
    python_config.oxidized_importer = False
    python_config.sys_frozen = True

    exe = dist.to_python_executable(
        name="LegkyiZvit",
        packaging_policy=policy,
        config=python_config,
    )

    # Keep this explicit list aligned with pyproject.toml. SQLModel still uses
    # SQLAlchemy internally, and both packages are bundled by pip_install.
    exe.add_python_resources(
        exe.pip_install([
            "fastapi==0.115.12",
            "uvicorn==0.34.0",
            "sqlmodel==0.0.24",
            "sqlalchemy==2.0.40",
            "jinja2==3.1.6",
            "python-multipart==0.0.20",
            "itsdangerous==2.2.0",
            "openpyxl==3.1.5",
        ])
    )
    exe.add_python_resources(exe.read_package_root(path=".", packages=["app"]))
    return exe


def make_embedded_resources(exe):
    return exe.to_embedded_resources()


def make_install(exe):
    files = FileManifest()
    files.add_python_resource(".", exe)
    assets = glob(
        [CWD + "/app/templates/**/*", CWD + "/app/static/**/*"],
        strip_prefix=CWD + "/",
    )
    files.add_manifest(assets)
    return files


register_target("exe", make_exe)
register_target("resources", make_embedded_resources, depends=["exe"], default_build_script=True)
register_target("install", make_install, depends=["exe"], default=True)

resolve_targets()
