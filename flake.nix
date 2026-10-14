{
  description = "EasyMourningReport development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      supportedSystems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
    in {
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
            packages = [ pkgs.python311 pkgs.poetry pkgs.go pkgs.git serve pkgs.antigravity-cli ];
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
    }
}
