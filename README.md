# 你画我猜 · Draw & Guess

一个基于 **React + Socket.IO** 的多人实时绘画猜词游戏。每轮一名玩家当「画家」选词作画，其余玩家在限定时间内通过聊天猜词，猜得越快分越高。

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4-010101?logo=socket.io&logoColor=white)

<<<<<<< HEAD
**在线体验**：<https://game.011208.shop>
=======

>>>>>>> eec9f3e8df17270f58c4c7f2e7011482db9e6142

---

## 功能特性

- **多人实时房间** — 6 位数字房间号，创建 / 加入，房主管理，可配 2~20 人
- **笔画级实时同步** — 基于 Socket.IO，画笔颜色 / 粗细、橡皮擦、**撤销（按笔）**、清空全部同步
- **选词机制** — 每轮 4 个候选词供画家选择，支持换一批（限 2 次）
- **动态计分** — 猜对越快分越高（保底 10 分）；画家按被猜中人数得分
- **智能回合控制** — 全员猜对提前结束、仅剩一人时倒计时缩短至 10 秒
- **断线重连** — 基于 `playerToken` 重连，分数与身份不丢失
- **响应式 UI** — 桌面端与移动端自适应布局

---

## 技术栈

| 端 | 技术 |
|----|------|
| **前端** | React 18 · TypeScript 5 · Vite 5 · React Router 6 · socket.io-client 4 |
| **后端** | Node.js 18+ · Express 4 · Socket.IO 4 |
| **存储** | 纯内存（服务端 `Map` 保存房间状态，无数据库） |
| **部署** | nginx（静态托管 + 反向代理）+ PM2 |

---

## 快速开始

### 环境要求

- Node.js ≥ 18

### 1. 启动后端（端口 4000）

```bash
cd server
npm install
npm run dev          # node --watch src/index.js
```

### 2. 启动前端（端口 3000）

```bash
cd client
npm install
npm run dev          # Vite，已配置 /socket.io 代理到 localhost:4000
```

### 3. 开始游戏

浏览器打开 <http://localhost:3000> ，开两个标签页或两台设备即可多人对战。

---

## 项目结构

```
draw-and-guess/
├── client/                  # 前端（React + Vite）
│   └── src/
│       ├── hooks/useSocket.ts   # 核心：socket 连接 + 全部游戏状态
│       ├── pages/               # Home / Room / Game
│       ├── components/          # Canvas / Chat / ScoreBoard
│       └── utils/storage.ts     # localStorage（playerToken 等）
├── server/                  # 后端（Node + Socket.IO）
│   └── src/
│       ├── index.js             # Socket.IO 服务 + 事件路由
│       ├── game.js              # RoomManager + GameLogic
│       └── words.js             # 词库
└── docs/                    # 技术 / 部署文档
```

---

## 游戏玩法

1. 输入昵称，**创建房间**（设置人数上限与每轮时长）或用房间号**加入**。
2. 所有人准备就绪后，房主**开始游戏**；玩家轮流担任画家（轮数 = 玩家数）。
3. 画家从 4 个词中**选词作画**；其余玩家在聊天框**猜词**。
4. 猜对即得分（越快越高），本轮结束公布答案与画作。
5. 所有人轮完一遍后，公布**最终排名**；房主可「再来一局」。

---

## 部署

生产环境基于 **nginx（静态托管 + 反向代理）+ PM2**：

```bash
# 前端：构建静态产物，部署到 nginx 根目录
cd client && npm run build      # 产物在 client/dist/

# 后端：PM2 守护
cd server && pm2 start src/index.js --name draw-guess
```

nginx 需将 `/api/` 与 `/socket.io/` 反代到后端 `:4000`，并为前端配置 SPA fallback。完整流程、配置、回滚与运维要点见 **[部署文档](docs/部署文档.md)**。

---

## 文档

- **[技术文档](docs/技术文档.md)** — 整体架构、前后端设计、完整游戏流程、Socket.IO 事件协议、计分规则、断线重连
- **[部署文档](docs/部署文档.md)** — 服务器环境、部署流程、nginx / PM2 配置、验证、回滚、运维注意事项

---

## 说明

- 房间状态为**纯内存存储**，服务进程重启后房间与分数将清空；如需持久化可自行引入数据库。
- 词库来源见 `server/src/words.js`，可按需替换或扩充。
