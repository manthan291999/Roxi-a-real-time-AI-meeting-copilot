import { useContext } from 'react';
import { ServicesContext, IServices } from './ServicesContext';

export const useServices = (): IServices => {
  const context = useContext(ServicesContext);
  if (!context) {
    throw new Error('useServices must be used within a ServicesProvider');
  }
  return context;
};
