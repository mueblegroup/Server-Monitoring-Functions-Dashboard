FROM node:24-alpine
RUN apk add --no-cache net-snmp-tools
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --chown=node:node package.json server.mjs services.mjs pfsense.mjs codex-usage.mjs spotify.mjs workspace.mjs ./
COPY --chown=node:node public ./public
RUN mkdir /app/data && chown node:node /app/data
USER node
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "server.mjs"]
