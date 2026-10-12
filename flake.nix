{
  description = "EasyMourningReport application package and development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    poetry2nix.url = "github:nix-community/poetry2nix";
    poetry2nix.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = { self, nixpkgs, poetry2nix }:
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
          poetry2nixLib = poetry2nix.lib.mkPoetry2Nix { inherit pkgs; };
          pythonEnv = poetry2nixLib.mkPoetryEnv {
            projectDir = ./.;
            python = pkgs.python311;
            groups = [ "main" ];
          };
          tailscaleHelper = pkgs.buildGoModule {
            pname = "tailscale-helper";
            version = "0.1.0";
            src = ./tailscale-helper;
            vendorHash = pkgs.lib.fakeHash;
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
