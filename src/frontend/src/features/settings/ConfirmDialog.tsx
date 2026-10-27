import { Button } from "@/shared/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/Dialog";
import { uk } from "@/shared/i18n/uk";
import type { ConfirmModalState } from "./types";

interface Props {
  state: ConfirmModalState;
  onOpenChange: (open: boolean) => void;
}

export function ConfirmDialog({ state, onOpenChange }: Props) {
  return (
    <Dialog open={state.open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{state.title}</DialogTitle>
          <DialogDescription>{state.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {uk.store.cancelButton}
          </Button>
          <Button
            variant={state.variant}
            onClick={() => {
              state.onConfirm();
              onOpenChange(false);
            }}
          >
            {state.actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
