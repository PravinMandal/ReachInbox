FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
# Full install: web build needs shared's typescript in the hoisted tree.
# (The old `|| true` swallowed real install failures into confusing build errors.)
RUN npm install
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN npm --workspace packages/shared run build && npm --workspace apps/web run build

FROM nginx:alpine
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
