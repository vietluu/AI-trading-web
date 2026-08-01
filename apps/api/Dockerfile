FROM node:22-bookworm-slim
WORKDIR /workspace
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --filter @platform/api... --frozen-lockfile --ignore-scripts
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @platform/api exec prisma generate
RUN pnpm --filter @platform/shared build && pnpm --filter @platform/api db:generate && pnpm --filter @platform/api build
EXPOSE 3001
CMD ["pnpm", "--filter", "@platform/api", "start"]
