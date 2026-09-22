# Jev Tank Arena

[English](README.md) | [简体中文](README.zh-CN.md)

一款在浏览器中运行的坦克对战游戏。玩家驾驶绿色坦克，与 Jev 驱动的橙色坦克战斗。

Jev 不仅控制对手，也可以担任竞技场导演，决定何时、在何处投放武器。游戏将 AI 决策与本地确定性物理、寻路、弹道预测和碰撞检测结合在一起。

## 演示

[观看游戏演示视频](docs/assets/jev-tank-arena-demo.mp4?raw=1)

## 功能特色

- 基于 Canvas 2D 的快速坦克战斗
- 随机且保证可达的出生位置
- 可以反弹并击中发射者的炮弹
- 机关枪、激光炮和地雷
- A* 寻路与实时弹道预测
- 在竞技场中显示 Jev 的决策概率
- 三种模式用于比较 AI 与本地控制
- 可导出决策记录用于调试

## 游戏模式

- **Jev Direct**：Jev 直接选择完整的移动、瞄准和开火操作。
- **Jev Tactical**：Jev 选择战术，本地系统负责瞄准和紧急闪避。
- **Local Practice**：无需 API Key，使用基于规则的本地行为。

Jev 请求采用异步方式。响应缓慢或请求失败不会暂停游戏，过期的决策会被丢弃。

## 快速开始

运行要求：

- Node.js 22 或更高版本
- 使用 Jev 模式时需要 TypeSafe API Key

```sh
nvm use
npm install
cp .env.example .env
```

在 `.env` 中填写 API Key：

```env
TYPESAFE_API_KEY=your_api_key
TYPESAFE_MODEL=jev-latest
PORT=3001
```

同时启动前端和后端：

```sh
npm run dev
```

打开 [http://127.0.0.1:5173](http://127.0.0.1:5173)。

API Key 只保留在服务端，不会发送到浏览器。Local Practice 模式不需要 API Key。

## 操作方式

| 操作 | 按键 |
| --- | --- |
| 移动 | `WASD` 或方向键 |
| 瞄准 | 鼠标 |
| 开火 | 鼠标左键或 `Space` |
| 暂停 | `P` |

每辆坦克拥有 3 点生命，率先获得 5 分的一方获胜。

## 技术栈

- React 与 TypeScript
- Canvas 2D
- Vite
- Node.js 与 Fastify
- TypeSafe SDK 与 Jev

## 常用命令

```sh
npm run dev        # 启动开发服务器和网页
npm test           # 运行测试
npm run build      # 类型检查并生成生产构建
npm start          # 在 127.0.0.1:3001 提供生产版本
npm run benchmark  # 运行离线战斗基准测试
npm run verify:jev # 发起真实 Jev 验证请求，会消耗 API 额度
```

## Jev 如何控制坦克

游戏会向 Jev 发送精简的竞技场状态和一组有效的控制候选项。每个候选项都包含移动方向、语义化瞄准模式和是否开火，并附带预测位移、墙面距离、危险程度及经过验证的弹道。

Jev 返回一个类型明确的选择和对应的概率分布。游戏在限定时间内执行被选中的操作，同时继续在本地模拟物理。无效、不安全、延迟过高或已经过期的操作会被拒绝。

## 许可证

MIT
