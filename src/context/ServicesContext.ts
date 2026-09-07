import { createContext } from 'react';
import { 
  ICaptureService, 
  IEventBus, 
  IChatService, 
  IHistoryRepository, 
  ISpeakerRepository 
} from '../shared/interfaces';

export interface IServices {
  captureService: ICaptureService;
  eventBus: IEventBus;
  chatService: IChatService;
  historyRepository: IHistoryRepository;
  speakerRepository: ISpeakerRepository;
}

export const ServicesContext = createContext<IServices | null>(null);
