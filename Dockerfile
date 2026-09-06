FROM node:24-alpine AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH \
    NODE_OPTIONS=--dns-result-order=ipv6first
RUN corepack enable

FROM base AS build

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.server.json tsconfig.web.json vite.config.ts ./
COPY src ./src
COPY web ./web
RUN pnpm run build && pnpm prune --prod

FROM node:24-alpine AS runtime

ENV NODE_ENV=production \
    HOST=:: \
    PORT=8080

WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O - 'http://[::1]:8080/api/health' || exit 1

CMD ["node", "dist/server/server.js"]
