import { beforeEach, describe, expect, it, vi } from "vitest";
import * as pref from "./biometricPref";

describe("biometric preference", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("remembers the choice and ignores junk", () => {
    expect(pref.biometricChoice()).toBeNull();
    pref.setBiometricChoice("on");
    expect(pref.biometricChoice()).toBe("on");
    window.localStorage.setItem("legkyi.biometric", "junk");
    expect(pref.biometricChoice()).toBeNull();
    pref.setBiometricChoice("declined");
    expect(pref.biometricChoice()).toBe("declined");
    pref.setBiometricChoice(null);
    expect(pref.biometricChoice()).toBeNull();
  });

  it("the fresh-login flag is consumed once", () => {
    expect(pref.takeFreshPasswordLogin()).toBe(false);
    pref.markFreshPasswordLogin();
    expect(pref.takeFreshPasswordLogin()).toBe(true);
    expect(pref.takeFreshPasswordLogin()).toBe(false);
  });

  it("suppresses auto sign-in until cleared", () => {
    expect(pref.autoBiometricSuppressed()).toBe(false);
    pref.suppressAutoBiometric();
    expect(pref.autoBiometricSuppressed()).toBe(true);
    pref.clearSuppressAutoBiometric();
    expect(pref.autoBiometricSuppressed()).toBe(false);
  });

  it("survives blocked storage", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(pref.biometricChoice()).toBeNull();
    expect(() => pref.setBiometricChoice("on")).not.toThrow();
    spy.mockRestore();
    set.mockRestore();
  });
});
