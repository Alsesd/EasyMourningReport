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
        exec go run ./cmd/server "$@"
      '';

      tunnel = pkgs.writeShellScriptBin "tunnel" ''
        PORT="''${PORT:-8000}"
        echo "Launching quick Cloudflare Tunnel forwarding to http://localhost:$PORT..."
        exec cloudflared tunnel --url "http://localhost:$PORT" "$@"
      '';
    in {
      default = pkgs.mkShell {
        packages = [
          pkgs.go
          pkgs.nodejs_22
          pkgs.cloudflared
          pkgs.git
          serve
          tunnel
        ];

        shellHook = ''
          echo "EasyMourningReport development shell (Go + Cloudflare Tunnel)"
          echo "Build the UI first: (cd frontend && npm ci && npm run build)"
          echo "Start server:     serve"
          echo "Expose publicly:  tunnel"
          echo "Run tests:        go test ./cmd/... ./internal/..."
        '';
      };
    });
  };
}
