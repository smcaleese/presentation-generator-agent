# syntax=docker/dockerfile:1
FROM node:22-slim
WORKDIR /app

# pnpm version comes from package.json "packageManager"
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

EXPOSE 5173
# Dev server for the hackathon. For prod: `pnpm run build` + serve dist/ with nginx.
CMD ["pnpm", "run", "dev"]
