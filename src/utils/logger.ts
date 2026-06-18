import winston from 'winston';
import { getContext } from './async-context';

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const level = () => {
  const env = process.env.NODE_ENV || 'development';
  return env === 'development' ? 'debug' : 'info';
};

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

winston.addColors(colors);

// Custom format: inject requestId and correlationId from AsyncLocalStorage
const addContext = winston.format((info) => {
  const ctx = getContext();
  if (ctx) {
    info.requestId = ctx.requestId;
    info.correlationId = ctx.correlationId;
  }
  return info;
});

// Development: colorized, human-readable with IDs appended
const devFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  addContext(),
  winston.format.colorize({ all: true }),
  winston.format.printf((info) => {
    const idStr = info.correlationId ? ` [corr:${info.correlationId}]` : '';
    return `${info.timestamp} ${info.level}${idStr}: ${info.message}`;
  }),
);

// Production: structured JSON — ideal for DataDog, CloudWatch, or any log aggregator
const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  addContext(),
  winston.format.json(),
);

const format = process.env.NODE_ENV === 'production' ? prodFormat : devFormat;

const transports = [
  new winston.transports.Console(),
  new winston.transports.File({
    filename: 'logs/error.log',
    level: 'error',
  }),
  new winston.transports.File({ filename: 'logs/all.log' }),
];

const logger = winston.createLogger({
  level: level(),
  levels,
  format,
  transports,
});

export default logger;
