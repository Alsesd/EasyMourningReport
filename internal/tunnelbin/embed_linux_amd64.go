//go:build bundle && linux && amd64

package tunnelbin

import _ "embed"

//go:embed bin/cloudflared-linux-amd64
var embedded []byte
