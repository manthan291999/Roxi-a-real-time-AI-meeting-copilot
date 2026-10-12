import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useServices } from '../../context/useServices';
import { TrialStatus } from '../../shared/types';
import { useAccount } from '../auth/AccountContext';

interface TrialContextValue {
  /** null until the first load, or if the backend could not be asked. */
  status: TrialStatus | null;
  /** On the trial with no time left: Start opens the plans instead. */
  isExhausted: boolean;
  refresh: () => Promise<void>;
  isUpgradeOpen: boolean;
  openUpgrade: () => void;
  closeUpgrade: () => void;
}

const TrialContext = createContext<TrialContextValue | null>(null);

/**
 * The free-trial allowance and the plans sheet. The backend meters and
 * enforces the trial; this only mirrors it for the UI and opens the plans
 * when it runs out.
 */
export const TrialProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { billingService, eventBus } = useServices();
  const { account } = useAccount();
  const [status, setStatus] = useState<TrialStatus | null>(null);
  const [isUpgradeOpen, setUpgradeOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await billingService.getTrialStatus());
    } catch (err) {
      console.error('Trial status unavailable:', err);
    }
  }, [billingService]);

  // Reload whenever the account (and so the plan) changes.
  useEffect(() => {
    void refresh();
  }, [refresh, account]);

  useEffect(
    () =>
      eventBus.onTrialEnded((ended) => {
        setStatus(ended);
        setUpgradeOpen(true);
      }),
    [eventBus],
  );

  const value = useMemo<TrialContextValue>(
    () => ({
      status,
      isExhausted: !!status && !status.unlimited && status.remainingSeconds <= 0,
      refresh,
      isUpgradeOpen,
      openUpgrade: () => setUpgradeOpen(true),
      closeUpgrade: () => setUpgradeOpen(false),
    }),
    [status, refresh, isUpgradeOpen],
  );

  return <TrialContext.Provider value={value}>{children}</TrialContext.Provider>;
};

export function useTrial(): TrialContextValue {
  const value = useContext(TrialContext);
  if (!value) throw new Error('useTrial must be used inside <TrialProvider>');
  return value;
}
