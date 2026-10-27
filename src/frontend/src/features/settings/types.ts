export interface TunnelStatus {
  enabled: boolean;
  autostart: boolean;
  has_token?: boolean;
  state: string;
  public_url: string;
  login_url: string;
  error: string;
}

export type Notify = (text: string, kind?: "ok" | "err") => void;

export interface ConfirmModalState {
  open: boolean;
  title: string;
  description: string;
  actionLabel: string;
  variant: "destructive" | "primary";
  onConfirm: () => void;
}
