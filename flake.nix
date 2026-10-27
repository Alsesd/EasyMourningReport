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
        cd backend
        exec uv run --project .. python -m app "$@"
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
          pkgs.nodejs_22
          pkgs.cloudflared
          pkgs.git
          serve
          tunnel
        ];

        shellHook = ''
          echo "EasyMourningReport development shell (uv + Cloudflare Tunnel)"

          # Create the migration lock only on first setup; afterward keep it authoritative.
          if [ ! -f uv.lock ]; then
            uv lock
          fi
          uv sync --locked

          test() {
            if [ "$#" -eq 0 ]; then
              uv run --locked pytest --cov=app --cov-branch --cov-report=term-missing --cov-fail-under=95
            else
              uv run --locked pytest "$@"
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
