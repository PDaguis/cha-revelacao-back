# Node puro, sem dependência para instalar.
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json server.js regras.js ./
COPY armazens ./armazens

# a pasta dos palpites é o ponto de montagem do volume; precisa ser do
# usuário "node", que é quem roda o servidor
RUN mkdir -p /app/dados && chown -R node:node /app

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ || exit 1

CMD ["node", "server.js"]
