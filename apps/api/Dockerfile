FROM node:20-alpine AS base
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm install --workspace @reachinbox/api --include-workspace-root=false || npm install
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN npm --workspace packages/shared run build \
  && npm --workspace apps/api run db:generate \
  && npm --workspace apps/api run build
EXPOSE 4000
