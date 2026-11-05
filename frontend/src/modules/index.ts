/**
 * Installed frontend modules. To add one, create `src/modules/<name>/module.tsx` exporting an
 * `AppModule` (see `src/platform/modules.ts`; `modules/transport` is a minimal template) and list it here.
 */

import type { AppModule } from "@/platform/modules";
import { reportsModule } from "@/modules/reports/module";
import { transportModule } from "@/modules/transport/module";

export const installedModules: AppModule[] = [reportsModule, transportModule];
