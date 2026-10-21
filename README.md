# TopPath Survivor

以寶可夢為主角的「割草」生存遊戲（類似 Survivor.io、Megabonk），使用
*寶可夢不可思議的迷宮* 的像素圖，加上 roguelike 元素、**9 個世代共 966 隻寶可夢**、
閃光寶可夢和各地區的扭蛋。音樂與音效都是為這個遊戲製作的。

純 HTML + CSS + JavaScript（Canvas 2D），沒有任何相依套件。

這個版本是 [JPTER78/pokesurvivor](https://github.com/JPTER78/pokesurvivor)
的**區網分支**：可以架在一台電腦上（或用 Docker），讓同一個網路裡的人一起玩，
不需要網際網路，也不用 Firebase。

> **原作者**
>
> 原作 PokéSurvivor（程式碼與原創音樂）由 **Jonathan Piera Torregrosa**
> （GitHub 帳號 JPTER78）撰寫並擁有。這個 repo 是根據原作修改的非官方版本，
> 與原作者無關；原作的官方網站是 [pokesurvivor.com](https://pokesurvivor.com)。

> **關於加密貨幣**
>
> 本遊戲**沒有任何官方的加密貨幣、代幣或 NFT**。任何使用遊戲名稱的代幣都是
> 第三方建立的，與本專案無關，這裡的內容也不構成任何投資建議。遊戲免費，而且會一直免費。

## 這個版本多了什麼

- **區網伺服器**（`server/`）：帳號、存檔、排行榜都存在架伺服器的那台電腦上，
  網路裡的任何裝置用名稱和密碼登入即可。
- **多人最多 8 人**（線上版是 4 人）；超過 4 人時同時出現的敵人更多（8 人最多 128 隻）。
- **對抗模式**：最多 3 隊、每隊 3 人，各隊分開升級、計算擊倒數，也可以攻擊其他隊。
- **斷線重連**：多人遊戲中重新整理頁面或瀏覽器關掉，可以從「多人遊戲」回到原本的對戰。
- **好友度**：同一隻寶可夢每玩 10 場（2 分鐘以上）得 1 點，最多 100 點，會稍微提高血量、攻擊和速度。
- **區網好友**：伺服器上的所有玩家自動互為好友，有搜尋和黑名單。
- **自訂角色**：「彩骰」卡池的 6 位魔法師（Glacius、Floria、Amora、Ignis、Dulcín、Voltio）和 Belle。
- **語言**：英文和繁體中文（在「設定」中切換）。

## 開始玩

### 用 Docker（建議）

```
docker compose up -d        # 啟動（背景執行）
docker compose logs -f      # 看 log
docker compose down         # 停止
```

然後用瀏覽器打開 `http://<這台電腦的 IP>:8877`。

- 玩家資料存在 volume `pokesurvivor_pokesurvivor-data`，重建或更新都不會清掉。
- **熱更新**：`docker-compose.yml` 直接把這個資料夾掛進容器，伺服器每次都從磁碟讀檔。
  改完遊戲後在電腦上 build（見下方「發布新版本」），玩家 5 分鐘內就會自動換到新版本，
  不用重建映像。只有改了 `server/*.js` 才需要 `docker compose restart`。

### 直接用 Node

需要 Node 18 以上，不用安裝任何套件：

```
node server/server.js                         # http://<伺服器IP>:8877
PORT=3000 node server/server.js               # 換連接埠
node server/server.js --list                  # 列出帳號
node server/server.js --reset 名稱 新密碼       # 幫忘記密碼的玩家重設
```

詳細步驟見 [server/README.md](server/README.md) 與 [docs/部署到區網.md](docs/部署到區網.md)。

### 操作

| 按鍵 | 動作 |
|---|---|
| `W` `A` `S` `D` / 方向鍵 | 移動 |
| `1` `2` `3` `4` | 選擇使用中的招式 |
| `Q` / `E` | 切換招式 |
| `Esc` / `P` | 暫停 |

**手機或平板**（橫向）：手指放在任何地方拖曳就能移動（搖桿會出現在按的位置），
點下方的招式切換，右上角的按鈕暫停。可以「加入主畫面」當成 App 使用。
也支援遊戲手把。

## 遊戲內容

- 寶可夢會自動用使用中的招式攻擊。擊敗傳說寶可夢後可以把招式**連結**，從同一格一起施放（最多 4 個）。
- 有**屬性相剋**和**天氣**（晴天、下雨、沙暴、下雪、起霧），會強化或削弱某些屬性。
- 招式分**物理**和**特殊**，對應寶可夢的攻擊／特攻和敵人的防禦／特防。
- 地圖上有**力量祭壇**、可以回血的**泉水**、**上鎖的寶箱**和**陷阱**；偶爾會出現**裂縫**，進去可以和傳說寶可夢單挑。
- 每天和每週都有**任務**可以拿扭蛋券和金幣；**成就**會給獎章和稱號。
- 每隻寶可夢的**強化**是分開的；**扭蛋**用遊玩獲得的扭蛋券來抽。
- 每隻敵人有 1/4096 的機率是**閃光**的，擊敗就能得到；扭蛋每 100 抽出 1 隻閃光。
- 招式升到最高等級會**進化**；可以花錢解鎖每隻寶可夢的**初始招式**。

## 發布新版本

1. 只修改 `dev.html`（`index.html` 是自動產生的）。
2. 執行：

   ```
   node tools/build.js && node tools/export_data.js && python tools/make_seo_pages.py
   ```

   `build.js` 會產生 `index.html`、`js/app.min.js` 和 `version.json`。
3. 遊戲每 5 分鐘檢查一次 `version.json`：不在對戰中的玩家會在 5 秒提示後重新載入；
   對戰中的玩家等那場結束、回到選單後才會更新，不會損失任何進度。
4. 每項遊戲變更都要寫進 `js/data/changelog.js`（西班牙文和英文），
   中文翻譯加在 `js/data/lang-zh.js`。

## 翻譯

遊戲本身以西班牙文撰寫，畫面上的文字用字典翻譯：

- 英文：`js/data/lang-en.js`
- 繁體中文：`js/data/lang-zh.js`（優先），缺的部分由 `lang-zh-hant.js` 補上；
  `tools/build_langs.js` 會把它們合併成 `js/lang/zh-Hant.js`。
- 檢查還缺哪些翻譯：`node tools/build_langs.js --faltan`

## 測試

```
node --test tests/i18n.test.cjs tests/net.test.cjs
```

## 資料夾結構

```
dev.html                畫面與載入順序（build 後產生 index.html）
css/style.css           介面樣式
assets/pokemon/{dex}/   PMD 格式的動畫圖（Idle、Walk、Attack、Shoot……）
assets/pokemon/{dex}/s/ 閃光版本
server/                 區網伺服器（帳號、存檔、排行榜、房間、多人中繼）
js/
  core/     util、db（存檔）、audio、input、sprites、i18n、locales
  data/     pokedex*、sprites-meta*、custom（自訂角色）、moves、enemies、lang-*
  world/    地圖與地形
  entities/ 玩家、敵人、投射物、道具、特效
  systems/  戰鬥、敵人生成、升級、扭蛋、裂縫……
  net/      好友與房間（雲端／區網）、WebRTC、多人同步、排行榜
  ui/       各個畫面
  game.js   主流程與主迴圈
tools/      建置與重新產生資料（標 * 的檔案）的腳本
```

## 授權與致謝

- 程式碼採用 [PolyForm Noncommercial 1.0.0](LICENSE-NONCOMMERCIAL.md)（原作自
  2026-10-14 起的授權）：可以使用、研究、修改，但**不得用於商業用途**。
  原作在 commit `b297089` 以前的版本採用 MIT。詳見 [LICENSE](LICENSE)。
- 寶可夢圖片來自 [SpriteCollab](https://github.com/PMDCollab/SpriteCollab)，採用
  **CC BY-NC 4.0**（非商業、須標示作者），作者名單見 [CREDITS.md](CREDITS.md)。
- 字型 Pixelify Sans 採用 OFL 授權。
- 寶可夢為 Nintendo、Creatures Inc. 與 GAME FREAK 所有。這是非營利的粉絲專案。
