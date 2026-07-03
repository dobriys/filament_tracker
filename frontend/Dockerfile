# --- dev: vite dev-сервер с hot-reload (используется docker-compose.dev.yml) ---
FROM node:22-alpine AS dev

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# --- build: статическая сборка ---
FROM dev AS build
RUN npm run build

# --- prod: nginx со статикой (по умолчанию) ---
FROM nginx:alpine

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker-entrypoint.sh /docker-entrypoint-ft.sh

EXPOSE 5173
ENTRYPOINT ["/docker-entrypoint-ft.sh"]
