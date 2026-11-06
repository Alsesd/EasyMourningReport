import type { AdminGroup, AdminSection } from "@/platform/modules";

export const HUB_PATH = "/admin/manage";
const GROUP_ORDER: AdminGroup[] = ["access", "catalog", "system", "activity"];

export function sectionPath(id: string): string {
  return `${HUB_PATH}/${id}`;
}

export function groupSections(sections: AdminSection[]): [AdminGroup, AdminSection[]][] {
  return GROUP_ORDER.map((group) => [group, sections.filter((s) => s.group === group)] as [AdminGroup, AdminSection[]]).filter(
    ([, items]) => items.length > 0,
  );
}
