import { useState } from "react";
import { Button } from "@/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/Dialog";

export interface ConfirmRequest {
  title: string;
  description: string;
  actionLabel: string;
  variant?: "destructive" | "primary";
  onConfirm: () => void;
}

/** A confirmation dialog plus the `ask()` function that opens it. */
export function useConfirm(cancelLabel = "Скасувати") {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);

  const dialog = (
    <Dialog open={request !== null} onOpenChange={(open) => !open && setRequest(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{request?.title}</DialogTitle>
          <DialogDescription>{request?.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setRequest(null)}>
            {cancelLabel}
          </Button>
          <Button
            variant={request?.variant ?? "destructive"}
            onClick={() => {
              request?.onConfirm();
              setRequest(null);
            }}
          >
            {request?.actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { ask: setRequest, dialog };
}
