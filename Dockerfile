# NetNew server + dashboard. Agents run on the machines being monitored.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
COPY agent/package.json agent/
RUN npm ci --no-audit --no-fund
COPY web web
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
COPY agent/package.json agent/
RUN npm ci --omit=dev --no-audit --no-fund -w server && npm cache clean --force
COPY server server
COPY agent/index.js agent/
COPY --from=build /app/web/dist web/dist
VOLUME /data
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/index.js"]
