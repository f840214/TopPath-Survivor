# PokéSurvivor 區網伺服器
#   docker compose up -d        啟動（背景）
#   docker compose logs -f      看 log
#   docker compose down         停止
# 玩家資料在 volume「pokesurvivor-data」，更新映像不會清掉。
FROM node:22-alpine
WORKDIR /app
COPY . .
RUN rm -rf server/data .git tools/cache
ENV PORT=8877 HOST=0.0.0.0
EXPOSE 8877
VOLUME ["/app/server/data"]
CMD ["node", "server/server.js"]
