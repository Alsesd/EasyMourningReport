"""PyOxidizer configuration for EasyMourningReport / LegkyiZvit."""

def make_exe():
    dist = default_python_distribution()
    policy = dist.make_python_packaging_policy()
    policy.resources_location = "in-memory"
    policy.resources_location_fallback = "filesystem-relative:lib"

    python_config = dist.make_python_interpreter_config()
    python_config.run_filename = "run.py"

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

    exe.add_filesystem_relative_files(
        files=[
            ("app/templates", "app/templates"),
            ("app/static", "app/static"),
            ("run.py", "run.py"),
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
