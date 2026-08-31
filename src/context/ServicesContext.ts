import { createContext } from 'react';
import { ICaptureService } from '../interfaces/ICaptureService';
import { IHistoryRepository } from '../interfaces/IHistoryRepository';
import { IEventBus } from '../interfaces/IEventBus';
import { ISpeakerRepository } from '../interfaces/ISpeakerRepository';
import { IChatService } from '../interfaces/IChatService';

export interface Services {
  captureService: ICaptureService;
  historyRepo: IHistoryRepository;
  eventBus: IEventBus;
  speakerRepo: ISpeakerRepository;
  chatService: IChatService;
}

export const ServicesContext = createContext<Services | null>(null);
