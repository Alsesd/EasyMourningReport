import { uk } from "@/shared/i18n/uk";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/Card";
import { Database, Download } from "lucide-react";

export default function BackupSettings() {
  return (
    <div className="space-y-6 max-w-2xl animate-fade-in">
      <Card>
        <CardHeader className="p-4 sm:p-5 border-b border-border">
          <CardTitle className="text-base flex items-center space-x-2">
            <Database className="h-5 w-5 text-primary" />
            <span>{uk.settings.backup.title}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 space-y-5">
          <p className="text-sm text-text-muted">{uk.settings.backup.description}</p>

          <div>
            <a
              href="/admin/backup/download"
              download
              className="inline-flex items-center justify-center rounded-control font-medium transition-colors min-h-[44px] px-5 py-2.5 text-sm bg-primary text-primary-fg hover:opacity-95 shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary w-full sm:w-auto"
            >
              <Download className="h-4 w-4 mr-2" />
              {uk.settings.backup.downloadButton}
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
