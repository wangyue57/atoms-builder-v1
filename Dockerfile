FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/platform-server/package.json ./apps/platform-server/package.json
COPY packages/domain/package.json ./packages/domain/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/workspace/package.json ./packages/workspace/package.json
COPY packages/model-gateway/package.json ./packages/model-gateway/package.json
COPY packages/agent-runtime/package.json ./packages/agent-runtime/package.json
COPY packages/persistence/package.json ./packages/persistence/package.json
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY apps ./apps
COPY packages ./packages
COPY migrations ./migrations
COPY prompts ./prompts
RUN npm run build:local
RUN npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/apps/platform-server/package.json ./apps/platform-server/package.json
COPY --from=build --chown=node:node /app/apps/platform-server/dist ./apps/platform-server/dist
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist
COPY --from=build --chown=node:node /app/migrations ./migrations
COPY --from=build --chown=node:node /app/prompts ./prompts
USER node
EXPOSE 8787
CMD ["node", "apps/platform-server/dist/main.js"]
