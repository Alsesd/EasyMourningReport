import { Plus, X } from "lucide-react";
import { Button } from "@/ui/Button";
import { Input } from "@/ui/Input";
import { uk } from "@/modules/transport/i18n";

const t = uk.transport;

/** The ordered list of transit stops (for the ceremony) of one part of an order. */
export function StopsEditor({ stops, onChange, idPrefix, label }: { stops: string[]; onChange: (stops: string[]) => void; idPrefix: string; label: string }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-text-main">{label}</p>
      {stops.map((stop, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            id={`${idPrefix}-stop-${i}`}
            aria-label={t.stopLabel(i + 1)}
            value={stop}
            maxLength={200}
            placeholder={t.stopPlaceholder}
            onChange={(e) => onChange(stops.map((s, j) => (j === i ? e.target.value : s)))}
          />
          <Button type="button" variant="ghost" size="icon" aria-label={`${t.removeStop} ${i + 1}`} onClick={() => onChange(stops.filter((_, j) => j !== i))}>
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ))}
      {stops.length < 10 && (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...stops, ""])}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t.addStop}
        </Button>
      )}
    </div>
  );
}
