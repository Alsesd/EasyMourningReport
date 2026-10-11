"""PyOxidizer configuration for the standalone LegkyiZvit application.

PyOxidizer 0.24 bundles CPython 3.10. Runtime modules and extension modules
are placed in ./lib. The install manifest places templates and static assets
beside the executable so frozen asset lookup remains predictable.
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

    target_name = "LegkyiZvit.exe" if "windows" in BUILD_TARGET_TRIPLE else "LegkyiZvit"
    exe = dist.to_python_executable(
        name=target_name,
        packaging_policy=policy,
        config=python_config,
    )

    # Pin versions known to support the CPython 3.10 distribution bundled here.
    exe.add_python_resources(
        exe.pip_install([
            "fastapi==0.115.12",
            "uvicorn==0.34.0",
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
    # Additional files are staged through FileManifest (not PythonExecutable).
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
