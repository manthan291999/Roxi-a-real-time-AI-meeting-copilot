import { createContext } from 'react';
import {
  ICaptureService,
  IEventBus,
  IChatService,
  IHistoryRepository,
  ISpeakerRepository,
  IProjectRepository,
  IDocumentService,
  IUsageRepository,
  IAccountService,
  IFederatedSignInService,
  IBillingService
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
  accountService: IAccountService;
  federatedSignInService: IFederatedSignInService;
  billingService: IBillingService;
}

export const ServicesContext = createContext<IServices | null>(null);
