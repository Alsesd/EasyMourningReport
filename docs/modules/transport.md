# Transport module

**Location:** `frontend/src/modules/transport/`

The transport module currently owns the typed API surface for public tunnel lifecycle operations: status polling, starting with explicit public-access confirmation, disconnecting, and changing autostart. `AdminSettingsPage` uses this API wrapper for its existing tunnel settings section.

Tunnel process management, token discovery, saved state, and shutdown handling remain backend responsibilities in `backend/app/core/tunnel.py` and the application lifecycle module. The frontend must not infer that an endpoint is publicly reachable until the backend reports its state and URL.

A future extraction of the visual settings panel into a dedicated transport page/component should preserve the existing admin route and public-access confirmation behavior.
