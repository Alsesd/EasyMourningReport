/** The dispatcher turns a request down; the reason is shown to the desk. */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { transportApi } from "@/modules/transport/api";
import { transportError } from "@/modules/transport/errors";
import { uk } from "@/modules/transport/i18n";
import type { ProductRequest } from "@/modules/transport/types";
import { Button } from "@/ui/Button";
import { Input } from "@/ui/Input";
import { Notice, type NoticeMessage } from "@/ui/Notice";

const t = uk.transport;

export function RejectRequestForm({ request, onDone }: { request: ProductRequest; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<NoticeMessage | null>(null);
  const reject = useMutation({
    mutationFn: () => transportApi.rejectRequest(request.id, note.trim()),
    onSuccess: onDone,
    onError: (err: Error) => setMessage({ text: transportError(err), kind: "err" }),
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!note.trim()) return setMessage({ text: t.rejectReason, kind: "err" });
        reject.mutate();
      }}
    >
      <p className="text-sm text-text-muted">{request.organisation_name}</p>
      <Notice message={message} onDismiss={() => setMessage(null)} dismissLabel={uk.common.close} />
      <div>
        <label htmlFor="reject-note" className="mb-1.5 block text-sm font-medium text-text-main">
          {t.rejectReason}
        </label>
        <Input id="reject-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} autoFocus />
      </div>
      <Button type="submit" variant="destructive" className="min-h-[44px]" disabled={reject.isPending}>
        {reject.isPending ? uk.common.loading : t.rejectRequest}
      </Button>
    </form>
  );
}
