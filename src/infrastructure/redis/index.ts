import { redisConnection } from './connection';

export const redis = {
  connect: () => redisConnection.connect(),
  close: () => redisConnection.close(),
  ping: () => redisConnection.ping(),
  getClient: () => redisConnection.getClient(),
};
