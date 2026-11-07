---
name: project-biometric-login
description: why the automatic biometric prompt at login did not fire, and how the login page now starts passkey sign-in
type: project
---

Causes found (2026-11): BiometricOffer skipped the offer when the account already had ANY passkey (keys belong to other
devices, so this device never got the "on" flag); the sign-out suppress flag stayed in sessionStorage for the whole tab
session; Safari refuses an unprompted modal get(), and the rejection was swallowed as "cancelled".
**Why:** the modal prompt only fires when `biometricChoice()==="on"`; the flag is per device.
**How to apply:** LoginPage tries the modal once (device agreed, not right after sign-out), then WebAuthn conditional
mediation (`autocomplete="username webauthn"`, `passkeyApi.login({conditional, signal})`). A headless virtual
authenticator completes conditional requests by itself, so test the sign-out case with isConditionalMediationAvailable
stubbed to false. Dialogs: `.dialog-panel` in index.css centres by inset+margin (never transform); bell uses `ui/Popover`.
