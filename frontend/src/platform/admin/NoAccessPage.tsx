import { ukPlatform as uk } from "@/platform/i18n";
import { Card, CardContent } from "@/ui/Card";

/** Landing page for an account without any role yet. */
export default function NoAccessPage() {
  return (
    <Card className="max-w-xl">
      <CardContent className="p-6 space-y-2">
        <h1 className="text-lg font-semibold text-text-main">{uk.hub.noAccessTitle}</h1>
        <p className="text-sm text-text-muted">{uk.hub.noAccessText}</p>
      </CardContent>
    </Card>
  );
}
