//go:build bundle && windows && amd64

package tunnelbin

import _ "embed"

//go:embed bin/cloudflared-windows-amd64.exe
var embedded []byte
