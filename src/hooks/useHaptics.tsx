import { createContext, useContext, type ReactNode } from 'react';
import { useWebHaptics } from 'web-haptics/react';

type HapticTrigger = (input?: string | number | number[]) => void;

interface HapticsContextValue {
  trigger: HapticTrigger;
}

const HapticsContext = createContext<HapticsContextValue>({ trigger: () => {} });

export function HapticsProvider({ children }: { children: ReactNode }) {
  const { trigger } = useWebHaptics();
  return (
    <HapticsContext.Provider value={{ trigger }}>
      {children}
    </HapticsContext.Provider>
  );
}

export function useHaptics() {
  return useContext(HapticsContext);
}
