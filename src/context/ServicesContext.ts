import { createContext } from 'react';
import {
  ICaptureService,
  IEventBus,
  IChatService,
  IHistoryRepository,
  ISpeakerRepository,
  IProjectRepository,
  IDocumentService,
  IUsageRepository
} from '../shared/interfaces';

export interface IServices {
  captureService: ICaptureService;
  eventBus: IEventBus;
  chatService: IChatService;
  historyRepository: IHistoryRepository;
  speakerRepository: ISpeakerRepository;
  projectRepository: IProjectRepository;
  documentService: IDocumentService;
  usageRepository: IUsageRepository;
}

export const ServicesContext = createContext<IServices | null>(null);
