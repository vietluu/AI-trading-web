FROM node:22-bookworm-slim
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --filter @platform/web... --no-frozen-lockfile --ignore-scripts
COPY packages/shared packages/shared
COPY apps/web apps/web
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
RUN pnpm --filter @platform/shared build && pnpm --filter @platform/web build
EXPOSE 3000
CMD ["pnpm", "--filter", "@platform/web", "start"]
