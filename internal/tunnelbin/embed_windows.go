//go:build bundle && windows

package tunnelbin

import _ "embed"

//go:embed bin/cloudflared.exe
var embedded []byte
