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
        echo "Serving locally on http://localhost:$PORT"
        echo "To expose publicly via Cloudflare Tunnel, run 'tunnel' in another terminal."
        exec pdm run python run.py "$@"
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
          pkgs.pdm
          pkgs.cloudflared
          pkgs.git
          serve
          tunnel
        ];

        shellHook = ''
          export PDM_VENV_IN_PROJECT=true
          echo "EasyMourningReport development shell (PDM + Cloudflare Tunnel)"

          # Enforce in-project .venv creation
          pdm config venv.in_project true >/dev/null 2>&1 || true

          if [ ! -d .venv ]; then
            echo "Creating virtual environment..."
            pdm venv create --with-pip python3.11 >/dev/null 2>&1 || true
          fi

          if ! pdm lock --check >/dev/null 2>&1; then
            echo "Refreshing PDM lock file for pyproject.toml..."
            pdm lock
          fi

          pdm install

          test() {
            if [ "$#" -eq 0 ]; then
              pdm run pytest --cov=app --cov-branch --cov-report=term-missing --cov-fail-under=95
            else
              pdm run pytest "$@"
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
