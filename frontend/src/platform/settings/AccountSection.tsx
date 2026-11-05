/** Every signed-in user can change their own password. */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { accessApi } from "@/platform/access/api";
import { ukPlatform as uk } from "@/platform/i18n";
import type { SettingsSectionProps } from "@/platform/modules";
import { Card, CardHeader, CardTitle, CardContent } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Input } from "@/ui/Input";
import { Shield } from "lucide-react";

export default function AccountSection({ notify }: SettingsSectionProps) {
  const [password, setPassword] = useState("");
  const change = useMutation({
    mutationFn: (value: string) => accessApi.changeOwnPassword(value),
    onSuccess: (res) => {
      setPassword("");
      notify(res?.message || uk.account.changed);
    },
    onError: (err: Error) => notify(err.message || "Не вдалося змінити пароль.", "err"),
  });

  return (
    <div className="space-y-6 max-w-2xl animate-fade-in">
      <Card>
        <CardHeader className="p-4 sm:p-5 border-b border-border">
          <CardTitle className="text-base flex items-center space-x-2">
            <Shield className="h-5 w-5 text-primary" />
            <span>{uk.account.title}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 space-y-4">
          <p className="text-sm text-text-muted">{uk.account.description}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (password.length < 6) return;
              change.mutate(password);
            }}
            className="space-y-4"
          >
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
            <Button
              type="submit"
              variant="primary"
              className="min-h-[44px]"
              disabled={password.length < 6 || change.isPending}
            >
              {change.isPending ? uk.common.loading : uk.account.changeButton}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
