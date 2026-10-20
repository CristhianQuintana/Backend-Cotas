FROM node:24-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++ openssl
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npx prisma generate && npx tsc -p tsconfig.build.json

FROM node:24-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache python3 make g++ openssl \
  && addgroup -S cotas \
  && adduser -S cotas -G cotas
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev \
  && npm install --no-save --package-lock=false prisma@6.19.3 \
  && npx prisma generate \
  && npm cache clean --force \
  && apk del python3 make g++
COPY --from=build /app/dist ./dist
COPY docker/entrypoint.mjs ./docker/entrypoint.mjs
RUN chown -R cotas:cotas /app
USER cotas
ENV NODE_ENV=production
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health/live').then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "docker/entrypoint.mjs"]
