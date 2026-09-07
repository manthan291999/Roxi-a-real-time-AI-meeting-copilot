import React, { useMemo } from 'react';
import { ServicesContext, IServices } from './ServicesContext';
import {
  TauriCaptureService,
  TauriEventBus,
  TauriChatService,
  TauriHistoryRepository,
  SpeakerRepository
} from '../services';

interface ServicesProviderProps {
  children: React.ReactNode;
  /**
   * Overrides individual services. Production passes nothing and gets the Tauri
   * implementations; harnesses and previews inject fakes without the components
   * knowing the difference.
   */
  services?: Partial<IServices>;
}

export const ServicesProvider: React.FC<ServicesProviderProps> = ({ children, services: overrides }) => {
  const services = useMemo<IServices>(() => {
    return {
      captureService: new TauriCaptureService(),
      eventBus: new TauriEventBus(),
      chatService: new TauriChatService(),
      historyRepository: new TauriHistoryRepository(),
      speakerRepository: new SpeakerRepository(),
      ...overrides,
    };
  }, [overrides]);

  return (
    <ServicesContext.Provider value={services}>
      {children}
    </ServicesContext.Provider>
  );
};
