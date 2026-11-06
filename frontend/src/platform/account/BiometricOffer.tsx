/** After the first password sign-in on a device, offers biometric sign-in once; the answer is remembered per device. */

import { useEffect, useState } from "react";
import { Fingerprint } from "lucide-react";
import { passkeyApi, passkeysSupported } from "@/platform/auth/passkeys";
import { biometricChoice, setBiometricChoice, takeFreshPasswordLogin } from "@/platform/auth/biometricPref";
import { ukPlatform as uk } from "@/platform/i18n";
import { Button } from "@/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/ui/Dialog";

export function BiometricOffer() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!takeFreshPasswordLogin() || !passkeysSupported() || biometricChoice() !== null) return;
    let alive = true;
    // A device that already holds a key for this account is asked nothing.
    passkeyApi
      .list()
      .then((keys) => alive && !keys.length && setOpen(true))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const decline = () => {
    setBiometricChoice("declined");
    setOpen(false);
  };

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await passkeyApi.register(uk.auth.biometricDeviceName);
      setBiometricChoice("on");
      setOpen(false);
    } catch (err) {
      const e = err as Error;
      setError(e.name === "NotAllowedError" || e.name === "AbortError" ? uk.auth.passkeyCancelled : e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && decline()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{uk.auth.biometricOfferTitle}</DialogTitle>
          <DialogDescription>{uk.auth.biometricOfferText}</DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={decline} disabled={busy}>
            {uk.auth.biometricLater}
          </Button>
          <Button variant="primary" onClick={accept} isLoading={busy} disabled={busy}>
            <Fingerprint className="mr-2 h-4 w-4" aria-hidden="true" />
            {uk.auth.biometricEnable}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
