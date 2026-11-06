/** Manage the biometric sign-in keys of the signed-in user; shown in the account menu's dialog. */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fingerprint, Trash2 } from "lucide-react";
import { passkeyApi, passkeysSupported } from "@/platform/auth/passkeys";
import { setBiometricChoice } from "@/platform/auth/biometricPref";
import { formatDateTime, ukPlatform as uk } from "@/platform/i18n";
import { Button } from "@/ui/Button";
import { Input } from "@/ui/Input";
import { Notice, type NoticeMessage } from "@/ui/Notice";

export function PasskeysForm() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [message, setMessage] = useState<NoticeMessage | null>(null);
  const supported = passkeysSupported();
  const keys = useQuery({ queryKey: ["passkeys"], queryFn: passkeyApi.list, enabled: supported });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["passkeys"] });

  const add = useMutation({
    mutationFn: () => passkeyApi.register(name.trim()),
    onSuccess: () => {
      setName("");
      setBiometricChoice("on");
      setMessage({ text: uk.account.passkeyAdded, kind: "ok" });
      void refresh();
    },
    onError: (err: Error) =>
      // The user closing the device prompt is not an error worth a message.
      setMessage(err.name === "NotAllowedError" ? null : { text: err.message, kind: "err" }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => passkeyApi.remove(id),
    onSuccess: () => {
      setMessage({ text: uk.account.passkeyRemoved, kind: "ok" });
      void refresh();
    },
    onError: (err: Error) => setMessage({ text: err.message, kind: "err" }),
  });

  if (!supported) return <p className="text-sm text-text-muted">{uk.account.passkeysUnsupported}</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">{uk.account.passkeysDescription}</p>
      <Notice message={message} onDismiss={() => setMessage(null)} dismissLabel={uk.common.close} />
      <ul className="divide-y divide-border border-y border-border">
        {(keys.data ?? []).map((k) => (
          <li key={k.id} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-text-main">{k.name}</p>
              <p className="text-xs text-text-muted">
                {uk.account.passkeyCreated}: <span className="figure">{formatDateTime(k.created_at)}</span> · {uk.account.passkeyLastUsed}:{" "}
                {k.last_used_at ? <span className="figure">{formatDateTime(k.last_used_at)}</span> : uk.account.passkeyNever}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              className="min-h-[44px] min-w-[44px]"
              aria-label={`${uk.account.passkeyRemove}: ${k.name}`}
              onClick={() => remove.mutate(k.id)}
              disabled={remove.isPending}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </li>
        ))}
        {keys.data?.length === 0 && <li className="py-3 text-sm text-text-muted">{uk.account.passkeysEmpty}</li>}
      </ul>
      <form
        className="space-y-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <label htmlFor="passkey-name" className="text-xs font-medium text-text-muted">
          {uk.account.passkeyName}
        </label>
        <div className="flex gap-2">
          <Input
            id="passkey-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={uk.account.passkeyNamePlaceholder}
            maxLength={60}
            className="h-11"
          />
          <Button type="submit" className="min-h-[44px] shrink-0" disabled={add.isPending}>
            <Fingerprint className="mr-2 h-4 w-4" aria-hidden="true" />
            {add.isPending ? uk.common.loading : uk.account.passkeyAdd}
          </Button>
        </div>
      </form>
    </div>
  );
}
