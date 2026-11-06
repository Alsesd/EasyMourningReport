/** The dispatcher's reply: choose a status, add a note the desk will read (required when rejecting). */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { transportApi } from "@/modules/transport/api";
import { uk } from "@/modules/transport/i18n";
import type { TransportOrderDTO } from "@/platform/api/types";
import { Button } from "@/ui/Button";
import { Input } from "@/ui/Input";
import { Notice, type NoticeMessage } from "@/ui/Notice";

const t = uk.transport;

export function StatusForm({ order, status, onDone }: { order: TransportOrderDTO; status: string; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<NoticeMessage | null>(null);
  const reject = status === "rejected";
  const apply = useMutation({
    mutationFn: () => transportApi.setStatus(order.id, status, note.trim()),
    onSuccess: onDone,
    onError: (err: Error) => setMessage({ text: err.message, kind: "err" }),
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (reject && !note.trim()) return setMessage({ text: t.reasonLabel, kind: "err" });
        apply.mutate();
      }}
    >
      <p className="text-sm text-text-muted">
        {order.organisation.name} · {order.deceased} · <span className="figure">{order.sort_time}</span>
      </p>
      <Notice message={message} onDismiss={() => setMessage(null)} dismissLabel={uk.common.close} />
      <div className="space-y-1.5">
        <label htmlFor="status-note" className="text-sm font-medium text-text-main">
          {reject ? t.reasonLabel : t.noteLabel}
        </label>
        <Input id="status-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} autoFocus />
      </div>
      <Button type="submit" className="min-h-[44px]" variant={reject ? "destructive" : "primary"} disabled={apply.isPending}>
        {apply.isPending ? uk.common.loading : t.apply}
      </Button>
    </form>
  );
}
