import React from 'react';
import { ServicesContext, Services } from './ServicesContext';
import { TauriCaptureService } from '../services/TauriCaptureService';
import { TauriHistoryRepository } from '../services/TauriHistoryRepository';
import { TauriEventBus } from '../services/TauriEventBus';
import { SpeakerRepository } from '../services/SpeakerRepository';

const services: Services = {
  captureService: new TauriCaptureService(),
  historyRepo: new TauriHistoryRepository(),
  eventBus: new TauriEventBus(),
  speakerRepo: new SpeakerRepository(),
};

export const ServicesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <ServicesContext.Provider value={services}>
      {children}
    </ServicesContext.Provider>
  );
};
