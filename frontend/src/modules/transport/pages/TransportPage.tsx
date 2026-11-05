import { useQuery } from "@tanstack/react-query";
import { transportApi } from "@/modules/transport/api";
import { ukPlatform as uk } from "@/platform/i18n";
import { Card, CardContent } from "@/ui/Card";
import { Truck } from "lucide-react";

export default function TransportPage() {
  const { data } = useQuery({ queryKey: ["transport", "status"], queryFn: () => transportApi.status() });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-text-main">{uk.nav.transport}</h1>
      <Card>
        <CardContent className="p-6 flex items-center gap-3 text-text-muted">
          <Truck className="h-5 w-5 shrink-0" />
          <span>{data?.message ?? uk.common.loading}</span>
        </CardContent>
      </Card>
    </div>
  );
}
