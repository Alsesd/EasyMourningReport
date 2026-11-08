/** WebAuthn glue: converts the server's JSON options for the browser and the browser's answers back. */

import { api } from "@/platform/api/client";
import type { MessageDTO, PasskeyDTO, SessionDTO } from "@/platform/api/types";

interface Options {
  challenge_id: string;
  public_key: Record<string, unknown>;
}

const toBytes = (b64url: string): ArrayBuffer => {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64url.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};

const toB64 = (buf: ArrayBuffer): string => {
  let bin = "";
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** Passkeys need a secure context and the WebAuthn API. */
export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && typeof window.PublicKeyCredential === "function";
}

/** Conditional mediation: the browser offers the passkey in the username field's autofill list, with no modal and no tap needed first. */
export async function conditionalMediationAvailable(): Promise<boolean> {
  try {
    const pkc = window.PublicKeyCredential as (typeof PublicKeyCredential & { isConditionalMediationAvailable?: () => Promise<boolean> }) | undefined;
    return passkeysSupported() && typeof pkc?.isConditionalMediationAvailable === "function" && (await pkc.isConditionalMediationAvailable()) === true;
  } catch {
    return false;
  }
}

export interface PasskeyLoginOptions {
  /** Wait quietly for the person to pick the passkey from the autofill list (needs `autocomplete="... webauthn"` on the field). */
  conditional?: boolean;
  signal?: AbortSignal;
}

type Descriptor = { id: string; type: string };
const descriptors = (list: unknown): PublicKeyCredentialDescriptor[] =>
  ((list as Descriptor[] | undefined) ?? []).map((d) => ({ type: "public-key", id: toBytes(d.id) }));

export const passkeyApi = {
  list: () => api.get<PasskeyDTO[]>("/api/v1/passkeys"),
  remove: (id: number) => api.delete<MessageDTO>(`/api/v1/passkeys/${id}`),

  /** Registers this device. Throws the browser's error when the user cancels. */
  async register(name: string): Promise<MessageDTO> {
    const opts = await api.post<Options>("/api/v1/passkeys/options", {});
    const pk = opts.public_key as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const cred = (await navigator.credentials.create({
      publicKey: {
        ...pk,
        challenge: toBytes(pk.challenge),
        user: { ...pk.user, id: toBytes(pk.user.id) },
        excludeCredentials: descriptors(pk.excludeCredentials),
      } as PublicKeyCredentialCreationOptions,
    })) as PublicKeyCredential | null;
    if (!cred) throw new DOMException("cancelled", "NotAllowedError");
    const res = cred.response as AuthenticatorAttestationResponse;
    return api.post<MessageDTO>("/api/v1/passkeys", {
      challenge_id: opts.challenge_id,
      name,
      id: cred.id,
      client_data_json: toB64(res.clientDataJSON),
      attestation_object: toB64(res.attestationObject),
    });
  },

  /** Signs in with a discoverable credential (the device offers the matching account itself). */
  async login(mode: PasskeyLoginOptions = {}): Promise<SessionDTO> {
    const opts = await api.post<Options>("/api/v1/auth/passkey/options", {});
    const pk = opts.public_key as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const request: CredentialRequestOptions = {
      publicKey: { ...pk, challenge: toBytes(pk.challenge), allowCredentials: descriptors(pk.allowCredentials) } as PublicKeyCredentialRequestOptions,
    };
    if (mode.conditional) (request as { mediation?: string }).mediation = "conditional";
    if (mode.signal) request.signal = mode.signal;
    const cred = (await navigator.credentials.get(request)) as PublicKeyCredential | null;
    if (!cred) throw new DOMException("cancelled", "NotAllowedError");
    const res = cred.response as AuthenticatorAssertionResponse;
    return api.post<SessionDTO>("/api/v1/auth/passkey", {
      challenge_id: opts.challenge_id,
      id: cred.id,
      client_data_json: toB64(res.clientDataJSON),
      authenticator_data: toB64(res.authenticatorData),
      signature: toB64(res.signature),
    });
  },
};
