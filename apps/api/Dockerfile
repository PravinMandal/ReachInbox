FROM node:20-alpine AS base
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
# Full install (not workspace-scoped): the build below needs shared's devDeps
# (typescript) and api's (prisma) in one hoisted tree. A scoped install only
# "works" via fallback and fails confusingly on cold caches.
RUN npm install
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN npm --workspace packages/shared run build \
  && npm --workspace apps/api run db:generate \
  && npm --workspace apps/api run build
EXPOSE 4000
