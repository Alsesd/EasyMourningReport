{
  description = "EasyMourningReport development environment (Poetry-managed Python dependencies)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = {
    self,
    nixpkgs,
  }: let
    supportedSystems = ["x86_64-linux" "aarch64-linux"];
    forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
  in {
    devShells = forAllSystems (system: let
      pkgs = import nixpkgs {
        inherit system;
        allowUnfree = true;
      };
      serve = pkgs.writeShellScriptBin "serve" ''
        export HOST="''${HOST:-127.0.0.1}"
        if command -v tailscale >/dev/null 2>&1; then
          tailscale funnel --bg "''${PORT:-8000}" || echo "Funnel failed; see README"
          export COOKIE_SECURE=1
          tailscale funnel status
        else
          echo "tailscale not found: serving locally on http://localhost:''${PORT:-8000}"
        fi
        exec poetry run python run.py "$@"
      '';
    in {
      default = pkgs.mkShell {
        packages = [pkgs.python311 pkgs.poetry pkgs.git serve pkgs.antigravity-cli];
        shellHook = ''
          export POETRY_VIRTUALENVS_IN_PROJECT=true
          echo "EasyMourningReport development shell (Poetry)"
          if [ ! -d .venv ]; then
            echo "Run 'poetry install' once to create the project environment."
          fi
          echo "Start server: serve (or serve --reload)"
          echo "Run tests: poetry run python -m unittest discover -s tests -v"
        '';
      };
    });
  };
}
