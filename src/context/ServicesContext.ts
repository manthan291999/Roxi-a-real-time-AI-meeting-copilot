import { createContext } from 'react';
import { ICaptureService } from '../interfaces/ICaptureService';
import { IHistoryRepository } from '../interfaces/IHistoryRepository';
import { IEventBus } from '../interfaces/IEventBus';
import { ISpeakerRepository } from '../interfaces/ISpeakerRepository';

export interface Services {
  captureService: ICaptureService;
  historyRepo: IHistoryRepository;
  eventBus: IEventBus;
  speakerRepo: ISpeakerRepository;
}

export const ServicesContext = createContext<Services | null>(null);
