import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DeviceSetup } from "./DeviceSetup";
import { AuthProvider } from "@/platform/auth/AuthContext";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { captureInstallPrompt } from "./installPrompt";
import { syncPushSubscription } from "./push";
import type { SessionDTO } from "@/platform/api/types";

const session: SessionDTO = {
  user_id: 1, login: "desk", full_name: "Оксана", organisation: { id: 3, name: "Філія А" },
  roles: [], permissions: [], modules: [], period: "2026-11",
};

vi.mock("./push", () => ({ syncPushSubscription: vi.fn(() => Promise.resolve()), dropPushSubscription: vi.fn(() => Promise.resolve()) }));

function renderSetup(signedIn = true) {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(signedIn
    ? { ok: true, status: 200, json: () => Promise.resolve(session) }
    : { ok: false, status: 401, json: () => Promise.resolve({ detail: "no" }) })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <DeviceSetup />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

class FakeNotification {
  static permission: NotificationPermission = "default";
  static requestPermission = vi.fn(() => {
    FakeNotification.permission = "granted";
    return Promise.resolve("granted" as NotificationPermission);
  });
}

describe("DeviceSetup", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    FakeNotification.permission = "default";
    FakeNotification.requestPermission.mockClear();
    vi.stubGlobal("Notification", FakeNotification);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("offers notifications after sign-in and asks the browser from the click", async () => {
    renderSetup();
    fireEvent.click(await screen.findByRole("button", { name: "Увімкнути сповіщення" }));
    await waitFor(() => expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(syncPushSubscription).toHaveBeenCalled()); // registers the browser for Web Push
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()); // nothing left to offer
  });

  it("says nothing to a signed-out visitor or to a device that already decided", async () => {
    renderSetup(false);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not ask again for a week after 'Later'", async () => {
    const first = renderSetup();
    fireEvent.click(await screen.findByRole("button", { name: "Пізніше" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    first.unmount();
    renderSetup();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is silent when notifications are already decided and the app is installed", async () => {
    FakeNotification.permission = "granted";
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }));
    renderSetup();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("installs through the captured browser prompt", async () => {
    FakeNotification.permission = "denied";
    captureInstallPrompt();
    const prompt = vi.fn(() => Promise.resolve());
    const ev = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted" as const }),
    });
    renderSetup();
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    fireEvent.click(await screen.findByRole("button", { name: "Встановити програму" }));
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
