FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN npm install --workspace @reachinbox/web --include-workspace-root=false || true
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN npm --workspace packages/shared run build && npm --workspace apps/web run build

FROM nginx:alpine
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
