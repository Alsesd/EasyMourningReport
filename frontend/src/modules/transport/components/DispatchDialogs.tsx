/** The dispatcher's dialogs around requests and runs, with the state to open them: add to a car, new/edit run, reject. */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { uk } from "@/modules/transport/i18n";
import type { Car, ProductRequest, Run } from "@/modules/transport/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/Dialog";
import { AddToRunForm } from "./AddToRunForm";
import { RejectRequestForm } from "./RejectRequestForm";
import { RunEditor } from "./RunEditor";

const t = uk.transport;

type RunDialog = { run?: Run; from?: ProductRequest } | null;

export function useDispatchDialogs({
  day,
  cars,
  openRequests,
  notify,
}: {
  day: string;
  cars: Car[];
  openRequests: ProductRequest[];
  notify: (text: string) => void;
}) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState<ProductRequest | null>(null);
  const [rejecting, setRejecting] = useState<ProductRequest | null>(null);
  const [runDialog, setRunDialog] = useState<RunDialog>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["transport"] });

  const dialogs = (
    <>
      <Dialog open={adding !== null} onOpenChange={(o) => !o && setAdding(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t.addToRunTitle}</DialogTitle>
          </DialogHeader>
          {adding && (
            <AddToRunForm
              request={adding}
              onNewRun={(from) => {
                setAdding(null);
                setRunDialog({ from });
              }}
              onDone={() => {
                setAdding(null);
                notify(t.cargoSaved);
                void refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={runDialog !== null} onOpenChange={(o) => !o && setRunDialog(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{runDialog?.run ? t.editRun : t.newRun}</DialogTitle>
          </DialogHeader>
          {runDialog && (
            <RunEditor
              day={runDialog.from?.need_date ?? day}
              cars={cars}
              openRequests={openRequests}
              run={runDialog.run}
              from={runDialog.from}
              onSaved={() => {
                setRunDialog(null);
                notify(t.runSaved);
                void refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={rejecting !== null} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.rejectDialog}</DialogTitle>
          </DialogHeader>
          {rejecting && (
            <RejectRequestForm
              request={rejecting}
              onDone={() => {
                setRejecting(null);
                notify(t.requestRejected);
                void refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
  return { addToRun: setAdding, reject: setRejecting, newRun: (from?: ProductRequest) => setRunDialog({ from }), editRun: (run: Run) => setRunDialog({ run }), dialogs };
}
