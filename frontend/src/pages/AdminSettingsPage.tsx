import { Card, CardContent } from "@/components/ui/Card";
import { uk } from "@/i18n/uk";

export default function AdminSettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-text-main">{uk.settings.title}</h1>
      <Card>
        <CardContent className="p-6">
          <p className="text-text-muted">{uk.common.loading}</p>
        </CardContent>
      </Card>
    </div>
  );
}
