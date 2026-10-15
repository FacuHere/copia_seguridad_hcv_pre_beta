FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node src ./src
COPY --chown=node:node public ./public

RUN mkdir -p /var/lib/hcv-files \
    && chown node:node /var/lib/hcv-files

ENV NODE_ENV=production
EXPOSE 3000
USER node

CMD ["node", "src/server.js"]
