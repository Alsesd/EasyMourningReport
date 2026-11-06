import type { SubmissionDTO } from "@/platform/api/types";
import { formatDateTime } from "@/platform/i18n";
import { uk } from "@/modules/reports/i18n";

/**
 * The report's signature next to its status: the employee who submitted it, or the administrator who locked
 * it. After an unlock only a store employee's submission is shown, as the last one. Reports from before the
 * signature was recorded have none and show nothing.
 */
export function signatureText(status: string, submission: SubmissionDTO | null | undefined): string | null {
  if (!submission) return null;
  const when = formatDateTime(submission.submitted_at);
  if (status === "submitted") {
    return `${submission.kind === "admin" ? uk.signature.lockedBy : uk.signature.submittedBy}: ${submission.by} · ${when}`;
  }
  return submission.kind === "store" ? `${uk.signature.lastSubmittedBy}: ${submission.by} · ${when}` : null;
}

export function Signature({ status, submission, className }: { status: string; submission: SubmissionDTO | null | undefined; className?: string }) {
  const text = signatureText(status, submission);
  return text ? <span className={className}>{text}</span> : null;
}
