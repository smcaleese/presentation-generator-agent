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

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npx prisma generate && npm run build

EXPOSE 3001
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
