FROM node:24-slim
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
COPY seed ./seed
ENV NODE_ENV=production PORT=4400 HOST=0.0.0.0 DB_PATH=/app/data/kotra.db
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 4400
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4400/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
