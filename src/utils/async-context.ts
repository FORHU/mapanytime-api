import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  requestId: string;
  correlationId: string;
}

export const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

export const getContext = (): RequestContext | undefined => {
  return asyncLocalStorage.getStore();
};

export const getCorrelationId = (): string | undefined => {
  return asyncLocalStorage.getStore()?.correlationId;
};

export const getRequestId = (): string | undefined => {
  return asyncLocalStorage.getStore()?.requestId;
};
