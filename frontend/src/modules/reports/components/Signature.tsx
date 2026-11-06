import type { SignatureDTO } from "@/platform/api/types";
import { formatDateTime } from "@/platform/i18n";
import { uk } from "@/modules/reports/i18n";

interface Signed {
  submission?: SignatureDTO | null;
  locked?: SignatureDTO | null;
}

/**
 * The report's signature lines next to its status: the employee who submitted it (after an unlock as the
 * last submission) and, while it is locked again by an administrator, who locked it. Reports from before
 * the signature was recorded have none and show nothing.
 */
export function signatureLines(status: string, { submission, locked }: Signed): string[] {
  const lines: string[] = [];
  if (submission) {
    const label = status === "submitted" ? uk.signature.submittedBy : uk.signature.lastSubmittedBy;
    lines.push(`${label}: ${submission.by} · ${formatDateTime(submission.signed_at)}`);
  }
  if (locked && status === "submitted") lines.push(`${uk.signature.lockedBy}: ${locked.by} · ${formatDateTime(locked.signed_at)}`);
  return lines;
}

export function Signature({ status, signed, className }: { status: string; signed: Signed; className?: string }) {
  return (
    <>
      {signatureLines(status, signed).map((line) => (
        <span key={line} className={className}>
          {line}
        </span>
      ))}
    </>
  );
}
