/** The dispatcher names the men who carry: one field per place of the ordered crew (4 or 6). */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { transportApi } from "@/modules/transport/api";
import { uk } from "@/modules/transport/i18n";
import type { TransportOrderDTO } from "@/platform/api/types";
import { Button } from "@/ui/Button";
import { Input } from "@/ui/Input";
import { Notice, type NoticeMessage } from "@/ui/Notice";

const t = uk.transport;

export function BearersForm({ order, onDone }: { order: TransportOrderDTO; onDone: () => void }) {
  const count = order.carriers?.count ?? 0;
  const [names, setNames] = useState<string[]>(() => Array.from({ length: count }, (_, i) => order.carriers?.bearers?.[i] ?? ""));
  const [message, setMessage] = useState<NoticeMessage | null>(null);
  const save = useMutation({
    mutationFn: () => transportApi.setBearers(order.id, names.map((n) => n.trim()).filter(Boolean)),
    onSuccess: onDone,
    onError: (err: Error) => setMessage({ text: err.message, kind: "err" }),
  });
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <p className="text-sm text-text-muted">
        {order.organisation.name} · {order.deceased} · <span className="figure">{order.carriers?.time}</span> · {t.crew(count)}
      </p>
      <Notice message={message} onDismiss={() => setMessage(null)} dismissLabel={uk.common.close} />
      {names.map((n, i) => (
        <Input
          key={i}
          aria-label={t.bearerLabel(i + 1)}
          placeholder={`${t.bearerLabel(i + 1)}: ${t.bearerPlaceholder.toLowerCase()}`}
          value={n}
          maxLength={100}
          onChange={(e) => setNames(names.map((x, j) => (j === i ? e.target.value : x)))}
        />
      ))}
      <Button type="submit" className="min-h-[44px]" disabled={save.isPending}>
        {save.isPending ? uk.common.loading : uk.common.save}
      </Button>
    </form>
  );
}
