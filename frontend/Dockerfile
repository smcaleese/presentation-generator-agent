# syntax=docker/dockerfile:1
FROM node:22-slim
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 5173
# Dev server for the hackathon. For prod: `npm run build` + serve dist/ with nginx.
CMD ["npm", "run", "dev"]
