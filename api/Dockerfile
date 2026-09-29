# syntax=docker/dockerfile:1
FROM node:22-slim AS base
WORKDIR /app
# openssl for Prisma; libreoffice + poppler for pptx -> pdf -> png rendering
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl \
      libreoffice-impress \
      poppler-utils \
      fonts-liberation \
      fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

# pnpm version comes from package.json "packageManager"
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm exec prisma generate && pnpm run build

EXPOSE 3001
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/index.js"]
