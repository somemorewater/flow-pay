FROM node:22-alpine
WORKDIR /app/apps/api
COPY apps/api/package.json apps/api/package-lock.json* ./
RUN pnpm install --production=false || npm install
COPY apps/api ./
COPY migrations /app/migrations
RUN pnpm run build
EXPOSE 4000
CMD ["sh", "-c", "pnpm run migrate && pnpm run seed && node dist/index.js"]
