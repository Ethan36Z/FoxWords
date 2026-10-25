# better-sqlite3 13 has no prebuilt binary, so npm compiles it. The full
# image has python3/make/g++; the runtime image stays slim.
FROM node:22-bookworm AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . ./
ENV NODE_ENV=production
EXPOSE 4000
CMD ["npm", "start"]
