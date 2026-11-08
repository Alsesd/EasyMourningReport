import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BiometricOffer } from "./BiometricOffer";
import { passkeyApi } from "@/platform/auth/passkeys";
import { biometricChoice, markFreshPasswordLogin } from "@/platform/auth/biometricPref";

vi.mock("@/platform/auth/AuthContext", () => ({ useAuth: () => ({ isAuthenticated: true }) }));
vi.mock("@/platform/auth/passkeys", () => ({
  passkeysSupported: vi.fn(() => true),
  passkeyApi: { list: vi.fn(), register: vi.fn() },
}));

const list = vi.mocked(passkeyApi.list);
const register = vi.mocked(passkeyApi.register);

describe("BiometricOffer", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    list.mockReset().mockResolvedValue([]);
    register.mockReset().mockResolvedValue({ message: "ok" } as never);
  });

  it("asks nothing without a fresh password sign-in", () => {
    render(<BiometricOffer />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });

  it("offers once after a password sign-in and remembers agreement", async () => {
    markFreshPasswordLogin();
    render(<BiometricOffer />);
    fireEvent.click(await screen.findByRole("button", { name: /Увімкнути/ }));
    await waitFor(() => expect(biometricChoice()).toBe("on"));
    expect(register).toHaveBeenCalled();
  });

  it("remembers a refusal and does not ask again", async () => {
    markFreshPasswordLogin();
    const { unmount } = render(<BiometricOffer />);
    fireEvent.click(await screen.findByRole("button", { name: "Не зараз" }));
    expect(biometricChoice()).toBe("declined");
    unmount();
    markFreshPasswordLogin();
    render(<BiometricOffer />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the dialog open with a note when the device prompt is cancelled", async () => {
    register.mockRejectedValue(Object.assign(new Error("x"), { name: "NotAllowedError" }));
    markFreshPasswordLogin();
    render(<BiometricOffer />);
    fireEvent.click(await screen.findByRole("button", { name: /Увімкнути/ }));
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(biometricChoice()).toBeNull();
  });

  it("asks a device that has not answered even when the account holds keys for other devices", async () => {
    // The old gate treated "the account has a key" as "this device has one", so a second phone was never asked and
    // never got the automatic prompt at sign-in.
    list.mockResolvedValue([{ id: 1 } as never]);
    markFreshPasswordLogin();
    render(<BiometricOffer />);
    expect(await screen.findByRole("button", { name: /Увімкнути/ })).toBeDefined();
  });

  it("remembers the agreement when the device already holds a key for the account", async () => {
    register.mockRejectedValue(Object.assign(new Error("x"), { name: "InvalidStateError" }));
    markFreshPasswordLogin();
    render(<BiometricOffer />);
    fireEvent.click(await screen.findByRole("button", { name: /Увімкнути/ }));
    await waitFor(() => expect(biometricChoice()).toBe("on"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
