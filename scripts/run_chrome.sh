#!/usr/bin/env bash
export LD_LIBRARY_PATH="/nix/store/rdfns118qkn18zd70jbxlvms8ng21hah-discord-1.0.161-fhsenv-rootfs/usr/lib64:/nix/store/rdfns118qkn18zd70jbxlvms8ng21hah-discord-1.0.161-fhsenv-rootfs/usr/lib:$LD_LIBRARY_PATH"
exec steam-run /home/alsesd/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell "$@"
