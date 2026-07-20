# syntax=docker/dockerfile:1
# Development-oriented image with hot reload (tsx watch).
# Source is bind-mounted by docker-compose; node_modules lives in the image.
FROM node:20-alpine

# bcrypt needs build tooling on alpine for its native addon; openssl is required
# by Prisma's query engine.
RUN apk add --no-cache python3 make g++ openssl

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json* ./
RUN npm install

# Copy the Prisma schema and generate the client at build time.
COPY prisma ./prisma
RUN npx prisma generate

# Copy the rest of the source (overridden by the bind mount in dev).
COPY . .

EXPOSE 4000

# The compose file runs migrations before starting; default to the dev server.
CMD ["npm", "run", "dev"]
