/** Per-device memory of the biometric sign-in choice. Nothing secret: only "agreed" / "declined" and two one-shot flags. */

const KEY = "legkyi.biometric";
const FRESH = "legkyi.freshPasswordLogin";
const NOAUTO = "legkyi.noAutoBiometric";

export type BiometricChoice = "on" | "declined" | null;

const read = (s: () => Storage, key: string): string | null => {
  try {
    return s().getItem(key);
  } catch {
    return null;
  }
};
const write = (s: () => Storage, key: string, value: string | null) => {
  try {
    if (value === null) s().removeItem(key);
    else s().setItem(key, value);
  } catch {
    // Storage may be blocked (private window); the feature then simply stays manual.
  }
};
const local = () => window.localStorage;
const session = () => window.sessionStorage;

export const biometricChoice = (): BiometricChoice => {
  const v = read(local, KEY);
  return v === "on" || v === "declined" ? v : null;
};
export const setBiometricChoice = (v: BiometricChoice) => write(local, KEY, v);

/** Set by the password form after a successful sign-in, consumed once by the offer dialog. */
export const markFreshPasswordLogin = () => write(session, FRESH, "1");
export const takeFreshPasswordLogin = (): boolean => {
  const v = read(session, FRESH) === "1";
  if (v) write(session, FRESH, null);
  return v;
};

/** After an explicit sign-out the login page must not pop the device prompt by itself. */
export const suppressAutoBiometric = () => write(session, NOAUTO, "1");
export const clearSuppressAutoBiometric = () => write(session, NOAUTO, null);
export const autoBiometricSuppressed = () => read(session, NOAUTO) === "1";
/** Reads and clears the flag: it holds back only the first login page after the sign-out, not every later visit of the tab. */
export const takeSuppressAutoBiometric = (): boolean => {
  const v = autoBiometricSuppressed();
  if (v) clearSuppressAutoBiometric();
  return v;
};
