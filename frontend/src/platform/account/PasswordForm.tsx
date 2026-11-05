/** Change your own password; shown in the account menu's dialog. */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { accessApi } from "@/platform/access/api";
import { ukPlatform as uk } from "@/platform/i18n";
import { Button } from "@/ui/Button";
import { Input } from "@/ui/Input";
import { Notice, type NoticeMessage } from "@/ui/Notice";

export function PasswordForm({ onDone }: { onDone?: () => void }) {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<NoticeMessage | null>(null);
  const change = useMutation({
    mutationFn: (value: string) => accessApi.changeOwnPassword(value),
    onSuccess: (res) => {
      setPassword("");
      setMessage({ text: res?.message || uk.account.changed, kind: "ok" });
      onDone?.();
    },
    onError: (err: Error) => setMessage({ text: err.message || "Не вдалося змінити пароль.", kind: "err" }),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (password.length >= 6) change.mutate(password);
      }}
      className="space-y-4"
    >
      <p className="text-sm text-text-muted">{uk.account.description}</p>
      <Notice message={message} onDismiss={() => setMessage(null)} dismissLabel={uk.common.close} />
      <div className="space-y-1.5">
        <label htmlFor="own-password" className="text-xs font-medium text-text-muted">
          {uk.account.newPassword}
        </label>
        <Input
          id="own-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={uk.account.placeholder}
          minLength={6}
          required
          className="h-11"
        />
        <span className="text-xs text-text-muted">{uk.account.minChars}</span>
      </div>
      <Button type="submit" className="min-h-[44px]" disabled={password.length < 6 || change.isPending}>
        {change.isPending ? uk.common.loading : uk.account.changeButton}
      </Button>
    </form>
  );
}
