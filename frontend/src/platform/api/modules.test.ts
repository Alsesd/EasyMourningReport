import { describe, it, expect, afterEach, vi } from "vitest";
import { transportApi } from "@/modules/transport/api";
import { accessApi } from "@/platform/access/api";
import { systemApi } from "@/platform/system/api";
import { mockFetch } from "@/test/fetchMock";

describe("API wrappers hit the documented routes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("transport", async () => {
    const calls = mockFetch({ "GET /api/v1/transport": [200, []], "POST /api/v1/transport": [200, {}], "PUT /api/v1/transport": [200, {}] });
    await transportApi.status();
    await transportApi.orders({ date: "2026-11-06", status: "done" });
    await transportApi.order(5);
    await transportApi.create({} as never);
    await transportApi.update(5, {} as never);
    await transportApi.cancel(5);
    await transportApi.setStatus(5, "accepted", "ok");
    await transportApi.setBearers(5, ["А"]);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET /api/v1/transport/status",
      "GET /api/v1/transport/orders?date=2026-11-06&status=done",
      "GET /api/v1/transport/orders/5",
      "POST /api/v1/transport/orders",
      "PUT /api/v1/transport/orders/5",
      "POST /api/v1/transport/orders/5/cancel",
      "POST /api/v1/transport/orders/5/status",
      "PUT /api/v1/transport/orders/5/bearers",
    ]);
    expect(calls[6].body).toEqual({ status: "accepted", note: "ok" });
    expect(calls[7].body).toEqual({ names: ["А"] });
  });

  it("access and system", async () => {
    const calls = mockFetch({ "GET /": [200, []], "POST /": [200, {}], "PUT /": [200, {}], "DELETE /": [200, {}] });
    await accessApi.sessions();
    await accessApi.endSession(3);
    await accessApi.endUserSessions(4);
    await accessApi.organisations();
    await accessApi.createOrganisation({ name: "x", first_user: null });
    await accessApi.updateOrganisation(1, { name: "y" });
    await accessApi.deleteOrganisation(1);
    await accessApi.restoreOrganisation(1);
    await accessApi.users({ platform: true });
    await accessApi.roles();
    await accessApi.permissions();
    await accessApi.changeOwnPassword("Abcdef12");
    await systemApi.tunnel();
    await systemApi.stopTunnel();
    await systemApi.setTunnelAutostart(true);
    await systemApi.backups(5);
    await systemApi.health();
    await systemApi.overview();
    await systemApi.update();
    await systemApi.checkUpdate();
    await systemApi.applyUpdate();
    expect(calls.length).toBe(21);
    expect(calls.find((c) => c.url.includes("/admin/sessions?user_id=4"))?.method).toBe("DELETE");
    expect(systemApi.backupDownloadUrl).toContain("/admin/backup/download");
  });
});
