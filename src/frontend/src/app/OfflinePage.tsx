import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/Card";

export function OfflinePage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-page p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Немає з’єднання</CardTitle>
          <CardDescription>
            Перевірте мережу. Незбережені чернетки залишаться в цьому браузері.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            to="/"
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-control bg-primary px-4 py-2 text-sm font-medium text-primary-fg transition-colors hover:bg-primary-hover"
          >
            Повернутися
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}

export default OfflinePage;
