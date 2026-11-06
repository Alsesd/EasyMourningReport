//go:build bundle && linux && arm64

package tunnelbin

import _ "embed"

//go:embed bin/cloudflared-linux-arm64
var embedded []byte
