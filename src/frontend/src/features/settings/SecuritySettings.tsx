import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/shared/api/client";
import type { MessageDTO } from "@/shared/api/types";
import { uk } from "@/shared/i18n/uk";
import { Button } from "@/shared/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/Card";
import { Input } from "@/shared/components/ui/Input";
import { Shield } from "lucide-react";
import type { Notify } from "./types";

interface Props {
  notify: Notify;
}

export default function SecuritySettings({ notify }: Props) {
  const [adminNewPassword, setAdminNewPassword] = useState("");

  const changeAdminPasswordMutation = useMutation({
    mutationFn: (password: string) =>
      api.put<MessageDTO>("/api/v1/admin/password", { password }),
    onSuccess: (res) => {
      setAdminNewPassword("");
      notify(res?.message || "Пароль адміністратора оновлено.");
    },
    onError: (err: Error) => notify(err.message || "Не вдалося змінити пароль.", "err"),
  });

  return (
    <div className="space-y-6 max-w-2xl animate-fade-in">
      <Card>
        <CardHeader className="p-4 sm:p-5 border-b border-border">
          <CardTitle className="text-base flex items-center space-x-2">
            <Shield className="h-5 w-5 text-primary" />
            <span>{uk.settings.security.title}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 space-y-4">
          <p className="text-sm text-text-muted">
            Введіть новий надійний пароль для облікового запису адміністратора (мінімум 6
            символів).
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (adminNewPassword.length < 6) return;
              changeAdminPasswordMutation.mutate(adminNewPassword);
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-muted">
                {uk.settings.security.currentAdminPassword}
              </label>
              <Input
                type="password"
                value={adminNewPassword}
                onChange={(e) => setAdminNewPassword(e.target.value)}
                placeholder="Введіть новий пароль"
                minLength={6}
                required
                className="h-11"
              />
              <span className="text-xs text-text-muted">{uk.settings.security.minChars}</span>
            </div>

            <Button
              type="submit"
              variant="primary"
              className="min-h-[44px]"
              disabled={
                adminNewPassword.length < 6 || changeAdminPasswordMutation.isPending
              }
            >
              {changeAdminPasswordMutation.isPending
                ? uk.common.loading
                : uk.settings.security.changeButton}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
