{ pkgs ? import <nixpkgs> { } }:

let
  root = toString ./.;

  # Python deps come from nixpkgs (no Poetry/pip needed, avoids manylinux wheel problems on NixOS)
  python = pkgs.python3.withPackages (ps: with ps; [
    fastapi
    uvicorn
    sqlalchemy # must be 2.x
    jinja2
    python-multipart
    itsdangerous
  ]);

  serve = pkgs.writeShellScriptBin "serve" ''
    export HOST="''${HOST:-127.0.0.1}"
    if command -v tailscale >/dev/null 2>&1; then
      tailscale funnel --bg 8000 || echo "Funnel failed, see README (NixOS section)"
      export COOKIE_SECURE=1
      tailscale funnel status
    else
      echo "tailscale not found: serving on http://localhost:8000 only"
    fi
    exec ${python}/bin/uvicorn --app-dir ${root} app.main:app --host "$HOST" --port 8000 "$@"
  '';
in
pkgs.mkShell {
  packages = [ python serve ];
  shellHook = ''
    echo "Sales reports dev shell. Start the server with:  serve   (add --reload while developing)"
    echo "Demo logins on first run: admin/admin, store1/store1, store2/store2"
  '';
}
