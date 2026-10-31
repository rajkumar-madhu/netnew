# NetNew backend + web app. Agents run on the machines being monitored.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY agent/package.json agent/
RUN npm ci --no-audit --no-fund
COPY frontend frontend
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY agent/package.json agent/
RUN npm ci --omit=dev --no-audit --no-fund -w backend && npm cache clean --force
COPY backend backend
COPY agent/package.json agent/
COPY agent/src agent/src
COPY --from=build /app/frontend/dist frontend/dist
VOLUME /data
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "backend/src/index.js"]
