import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/Button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { uk } from "@/i18n/uk";

export default function StoreReportPage() {
  const { session, logout } = useAuth();

  return (
    <div className="min-h-screen bg-page text-text-main p-4 max-w-md mx-auto">
      <header className="flex justify-between items-center py-2 border-b border-border mb-4">
        <div>
          <h1 className="font-semibold text-lg text-primary">{session?.store_name || session?.login}</h1>
          <p className="text-xs text-text-muted">{session?.period}</p>
        </div>
        <div className="flex items-center space-x-2">
          <ThemeToggle />
          <Button variant="ghost" size="sm" onClick={() => logout()}>
            {uk.auth.logoutButton}
          </Button>
        </div>
      </header>
      <main>
        <p className="text-sm text-text-muted">Завантаження форми звіту…</p>
      </main>
    </div>
  );
}
