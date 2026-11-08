/** After the first password sign-in on a device, offers biometric sign-in once; the answer is remembered per device. */

import { useEffect, useState } from "react";
import { Fingerprint } from "lucide-react";
import { useAuth } from "@/platform/auth/AuthContext";
import { passkeyApi, passkeysSupported } from "@/platform/auth/passkeys";
import { biometricChoice, setBiometricChoice, takeFreshPasswordLogin } from "@/platform/auth/biometricPref";
import { ukPlatform as uk } from "@/platform/i18n";
import { useDialogSlot } from "@/platform/device/dialogSlot";
import { Button } from "@/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/ui/Dialog";

export function BiometricOffer() {
  const { isAuthenticated } = useAuth();
  const [want, setWant] = useState(false);
  const open = useDialogSlot(want);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Asked on the first password sign-in of a device that has not answered yet. The account may already hold keys, but
  // those belong to other devices (or to a browser whose data was cleared): this device is the one being asked about.
  useEffect(() => {
    if (isAuthenticated && takeFreshPasswordLogin() && passkeysSupported() && biometricChoice() === null) setWant(true);
  }, [isAuthenticated]);

  const decline = () => {
    setBiometricChoice("declined");
    setWant(false);
  };

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await passkeyApi.register(uk.auth.biometricDeviceName);
      setBiometricChoice("on");
      setWant(false);
    } catch (err) {
      const e = err as Error;
      if (e.name === "InvalidStateError") {
        // The device already holds a key for this account: nothing to add, only remember it.
        setBiometricChoice("on");
        setWant(false);
        return;
      }
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
