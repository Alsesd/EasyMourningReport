{
  description = "EasyMourningReport development environment";

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
        config = {
          allowUnfree = true;
        };
      };

      serve = pkgs.writeShellScriptBin "serve" ''
        export HOST="''${HOST:-127.0.0.1}"
        export PORT="''${PORT:-8000}"
        export PYTHONDONTWRITEBYTECODE=1
        echo "Serving locally on http://localhost:$PORT"
        echo "To expose publicly via Cloudflare Tunnel, run 'tunnel' in another terminal."
        exec uv run python run.py "$@"
      '';

      tunnel = pkgs.writeShellScriptBin "tunnel" ''
        PORT="''${PORT:-8000}"
        echo "Launching quick Cloudflare Tunnel forwarding to http://localhost:$PORT..."
        exec cloudflared tunnel --url "http://localhost:$PORT" "$@"
      '';
    in {
      default = pkgs.mkShell {
        packages = [
          pkgs.python311
          pkgs.uv
          pkgs.cloudflared
          pkgs.git
          serve
          tunnel
        ];

        shellHook = ''
          export PYTHONDONTWRITEBYTECODE=1
          echo "EasyMourningReport development shell (uv + Cloudflare Tunnel)"

          if [ ! -d .venv ]; then
            echo "Creating virtual environment..."
            uv venv --python 3.11
          fi

          if ! uv lock --check >/dev/null 2>&1; then
            echo "Refreshing uv lock file for pyproject.toml..."
            uv lock
          fi

          uv sync

          test() {
            if [ "$#" -eq 0 ]; then
              uv run pytest --cov=app --cov-branch --cov-report=term-missing --cov-fail-under=95
            else
              uv run pytest "$@"
            fi
          }

          echo "Start server:     serve (or serve --reload)"
          echo "Expose publicly:  tunnel"
          echo "Run test suite:   test"
        '';
      };
    });
  };
}
