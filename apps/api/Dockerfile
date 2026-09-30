FROM node:22-alpine
RUN corepack enable
WORKDIR /app/apps/api
COPY apps/api/package.json apps/api/pnpm-lock.yaml apps/api/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY apps/api ./
COPY migrations /app/migrations
RUN pnpm run build
EXPOSE 4000
CMD ["sh", "-c", "pnpm run migrate && pnpm run seed && node dist/index.js"]
