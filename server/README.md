# 區域網路伺服器

讓遊戲在沒有網際網路、不用 Firebase 的區網裡運作：帳號、存檔、排行榜都保存在這個資料夾
（`server/data/`），也就是當伺服器的那台電腦上。

```
node server/server.js              # http://<伺服器IP>:8877
PORT=3000 node server/server.js    # 換埠
node server/server.js --list                 # 列出帳號
node server/server.js --reset 名稱 新密碼      # 幫忘記密碼的玩家重設
```

需要 Node 18 以上，不用安裝任何套件。

- 遊戲會自動偵測是不是由這個伺服器提供（`/api/ping`），是的話就把資料存在這裡；
  放到別的地方（例如 GitHub Pages）則照舊使用 Firebase。
- 備份：複製整個 `server/data/` 資料夾即可。
- 區網模式下：所有帳號自動互為好友、排行榜是伺服器自己的、合作模式（房間、邀請、
  WebRTC 信令與中繼）都經由 `server/lan.js` 的 WebSocket。

檔案說明：

| 檔案 | 內容 |
|---|---|
| `server.js` | 靜態檔案、帳號 API、存檔 |
| `lan.js` | 排行榜、在線玩家、房間、合作模式中繼 |
| `ws.js` | 自行實作的 WebSocket |

完整部署步驟見 `docs/部署到區網.md`。
