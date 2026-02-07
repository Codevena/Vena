# Stage 1: Build
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

# Copy workspace config and all package.json files for dependency caching
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY packages/providers/package.json packages/providers/
COPY packages/channels/package.json packages/channels/
COPY packages/gateway/package.json packages/gateway/
COPY packages/integrations/package.json packages/integrations/
COPY packages/agents/package.json packages/agents/
COPY packages/skills/package.json packages/skills/
COPY packages/computer/package.json packages/computer/
COPY packages/semantic-memory/package.json packages/semantic-memory/
COPY packages/voice/package.json packages/voice/
COPY apps/cli/package.json apps/cli/

RUN pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm build

# Stage 2: Runtime
FROM node:22-alpine AS runtime

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

# Copy workspace config
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Copy built packages with their package.json and dist
COPY --from=builder /app/packages packages
COPY --from=builder /app/apps apps
COPY --from=builder /app/node_modules node_modules

EXPOSE 18789

CMD ["node", "apps/cli/dist/index.js", "start"]
