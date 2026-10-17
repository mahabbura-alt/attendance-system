FROM node:24-alpine

ENV NODE_ENV=production \
    TZ=Asia/Jakarta \
    PORT=3000

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY backend ./backend

RUN chown -R node:node /app
USER node

EXPOSE 3000

CMD ["node", "backend/src/server.js"]
