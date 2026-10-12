{
  description = "EasyMourningReport application package and development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    runtimeNixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
  };

  outputs = { self, nixpkgs, runtimeNixpkgs }:
    let
      supportedSystems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
    in {
      packages = forAllSystems (system:
        let
          pkgs = import nixpkgs {
            inherit system;
            allowUnfree = true;
          };
          runtimePkgs = import runtimeNixpkgs {
            inherit system;
            allowUnfree = true;
          };
          python = runtimePkgs.python311.override {
            packageOverrides = self: super: {
              # Keep SQLModel's declared SQLAlchemy <2.1 constraint satisfied.
              sqlalchemy = super.sqlalchemy.overridePythonAttrs (old: {
                version = "2.0.54";
                src = runtimePkgs.fetchPypi {
                  pname = "SQLAlchemy";
                  version = "2.0.54";
                  format = "setuptools";
                  hash = "sha256-uqhSHo7p8k5138eqq8CAIOVR7w1I18PjU29c3fJ3WGs=";
                };
                doCheck = false;
              });
              sqlmodel = super.sqlmodel.overridePythonAttrs (old: {
                version = "0.0.24";
                src = runtimePkgs.fetchPypi {
                  pname = "sqlmodel";
                  version = "0.0.24";
                  format = "setuptools";
                  hash = "sha256-zFx2E8GlUzyceGfhqrL9SJp2yeigYZhNoRtOYTwYJCM=";
                };
                propagatedBuildInputs = [ self.pydantic self.sqlalchemy ];
                doCheck = false;
              });
            };
          };
          pythonEnv = python.withPackages (ps: [
            ps.fastapi
            ps.uvicorn
            ps.sqlmodel
            ps.sqlalchemy
            ps.jinja2
            ps.python-multipart
            ps.itsdangerous
            ps.openpyxl
          ]);
          tailscaleHelper = pkgs.buildGoModule {
            pname = "tailscale-helper";
            version = "0.1.0";
            src = ./tailscale-helper;
            vendorHash = "sha256-EDoGKs5XDkKfX5Lk+9PTdBtdvDuH65Vy9YIZ2P9wnq0=";
            subPackages = [ "." ];
            doCheck = false;
          };
          app = pkgs.stdenvNoCC.mkDerivation {
            pname = "easymourningreport";
            version = "1.0.0";
            dontUnpack = true;
            nativeBuildInputs = [ pkgs.makeWrapper ];
            installPhase = ''
              appRoot="$out/share/easymourningreport"
              mkdir -p "$appRoot" "$out/bin" "$appRoot/tailscale-helper/bin"
              cp -r ${./app} "$appRoot/app"
              cp ${./run.py} "$appRoot/run.py"
              cp ${tailscaleHelper}/bin/tailscale-helper "$appRoot/tailscale-helper/bin/tailscale-helper"
              chmod -R a-w "$appRoot"

              makeWrapper ${pythonEnv}/bin/python "$out/bin/easymourningreport" \
                --chdir "$appRoot" \
                --set PYTHONPATH "$appRoot" \
                --add-flags "$appRoot/run.py"
            '';
          };
        in {
          default = app;
          tailscale-helper = tailscaleHelper;
        });

      apps = forAllSystems (system: {
        default = {
          type = "app";
          program = "${self.packages.${system}.default}/bin/easymourningreport";
        };
      });

      devShells = forAllSystems (system:
        let
          pkgs = import nixpkgs {
            inherit system;
            allowUnfree = true;
          };
          serve = pkgs.writeShellScriptBin "serve" ''
            export HOST="''${HOST:-127.0.0.1}"
            echo "Serving locally on http://localhost:''${PORT:-8000}"
            echo "Public Tailscale Funnel is never started implicitly."
            exec poetry run python run.py "$@"
          '';
        in {
          default = pkgs.mkShell {
            packages = [ pkgs.python311 pkgs.poetry pkgs.git serve pkgs.antigravity-cli ];
            shellHook = ''
              export POETRY_VIRTUALENVS_IN_PROJECT=true
              echo "EasyMourningReport development shell (Poetry)"
              if [ ! -d .venv ]; then
                echo "Run 'poetry install' once to create the project environment."
              fi
              if ! poetry check --lock >/dev/null 2>&1; then
                echo "Refreshing Poetry lock file for the current pyproject.toml..."
                poetry lock --no-interaction
              fi
              poetry install --no-interaction
              test() {
                if [ "$#" -eq 0 ]; then
                  poetry run pytest --cov=app --cov-branch --cov-report=term-missing --cov-fail-under=95
                else
                  poetry run pytest "$@"
                fi
              }
              echo "Start server: serve (or serve --reload)"
              echo "Run tests and enforce 95% coverage: test"
            '';
          };
        });
    };
}
