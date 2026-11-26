# Build stage
# Node 22+, not 20: Better Auth ships ESM only and this CommonJS app loads it through
# require(esm), which needs 20.19+/22.12+ — and Node 20 is end-of-life (#122).
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

COPY . .

RUN npx prisma generate
RUN npm run build

# Production stage
FROM node:22-alpine

RUN apk add --no-cache openssl

WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules
# Not compiled into dist: `renderTemplate` reads these off disk at send time,
# resolving them against process.cwd(). Without this the whole directory is
# absent from the runtime image and every templated email dies on ENOENT —
# which the consumer turns into a retry and then the dead-letter queue, so the
# failure is silent unless someone goes looking at email.queue.dlq.
COPY --from=builder /app/email-template ./email-template

EXPOSE 4002

CMD ["npm", "run", "start"]
