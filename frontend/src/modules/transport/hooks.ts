/** Small hooks shared by the transport tabs. */

import { useEffect, useState } from "react";
import { todayIso } from "@/modules/transport/i18n";

/** Today's date that follows the clock: a page left open overnight moves to the new day unless a day was picked. */
export function useToday(): string {
  const [today, setToday] = useState(todayIso());
  useEffect(() => {
    const id = window.setInterval(() => setToday(todayIso()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return today;
}

/** The list is refreshed this often: the desks' notification is the dispatcher's reply showing up by itself. */
export const POLL_MS = 15000;
