# PolicyForge web app: built from source with Node, served by nginx at /app/, API calls proxied to the api service.
# Built from the policyforge/ folder: the build reads the JSON Schemas and FoodNet from backend/ (one source of truth).
FROM node:22-alpine AS build
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY backend/schemas /src/backend/schemas
COPY backend/data /src/backend/data
COPY frontend/ ./
RUN npx tsc --noEmit -p . && npx vite build

FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/frontend/dist /usr/share/nginx/html/app
EXPOSE 80
HEALTHCHECK --interval=5s --timeout=3s --retries=12 CMD wget -q -O /dev/null http://127.0.0.1/app/ || exit 1
