import { createContext, useContext } from "react";

export interface ToastApi {
  show: (message: string, options?: { error?: boolean }) => void;
}

export const ToastContext = createContext<ToastApi>({ show: () => undefined });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
