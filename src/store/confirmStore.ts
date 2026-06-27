import { create } from 'zustand';

/**
 * In-app replacement for the native `Alert.alert` confirmations/notifications.
 * Screens call the imperative `showAlert` / `showConfirm` actions; a single
 * `<ConfirmHost />` mounted in the root layout renders the dialog. Keeping the
 * dialog in-app (instead of the platform Alert) gives consistent dark styling,
 * custom button labels, and a destructive variant — the native Alert is jarring
 * on-device and can't be themed.
 */

type AlertOptions = {
  title: string;
  message?: string;
  okText?: string;
};

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  /** Renders the confirm button in the danger style (e.g. irreversible actions). */
  destructive?: boolean;
  onConfirm: () => void;
};

type ConfirmState =
  | { kind: 'alert'; options: AlertOptions }
  | { kind: 'confirm'; options: ConfirmOptions }
  | null;

type ConfirmStore = {
  state: ConfirmState;
  showAlert: (options: AlertOptions) => void;
  showConfirm: (options: ConfirmOptions) => void;
  dismiss: () => void;
};

export const useConfirmStore = create<ConfirmStore>((set) => ({
  state: null,
  showAlert: (options) => set({ state: { kind: 'alert', options } }),
  showConfirm: (options) => set({ state: { kind: 'confirm', options } }),
  dismiss: () => set({ state: null }),
}));
