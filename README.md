# Freebuff2API Web

这是一个可直接部署到 `Vercel` 的 Web 版本，支持：

- 首面访问密码
- 多账号池
- 固定账号 / 轮询账号调用
- Bookmarklet 书签脚本回传 token
- 手动导入 `authToken`
- OpenAI 风格接口：`/api/v1/chat/completions`

## 环境变量

- `DEFAULT_MODEL`: 选填，默认模型名
- `ACCESS_PASSWORD`: 选填，设置后首页会先要求输入访问密码

## 推荐登录方式

### 方案 A：Bookmarklet 书签脚本回传（推荐）

这是当前最接近“纯 Web 页自动导入”的方案。

#### 最新工作方式

书签脚本现在会优先：

1. 在 `freebuff.com` 已登录态下直接请求：
   - `/api/auth/cli/code`
   - `/api/auth/cli/status`
2. 如果站内接口返回 `user.authToken`，就立即回传到你的 Web 页
3. 如果接口拿不到，再退回到页面存储扫描模式

#### 使用方法

1. 打开你的 `Freebuff2API Web` 页面
2. 重新把页面里的“拖拽此按钮到书签栏”拖到浏览器书签栏
3. 登录 `https://freebuff.com/`
4. **进入登录后的主应用页面**，不要停在仅显示 “Login successful” 的过渡页
5. 点击书签
6. 页面会自动跳回你的 `Freebuff2API Web`
7. 如果成功抓到 token，会自动导入账号池

#### 重要提醒

- 你必须重新拖一次新的书签按钮，旧书签还是旧逻辑
- 最好在 `freebuff.com` 登录后的业务页面里点书签，而不是刚登录成功的提示页

### 方案 B：网页登录兜底

页面点击“新增 GitHub 登录账号”后，会尝试走 Freebuff 登录流程。

注意：如果登录页提示 `Login successful! Return to your terminal to continue.`，说明这个流程更偏向本地 CLI 场景，在 `Vercel` 云端轮询时可能返回 `401 Authentication failed`。

### 方案 C：手动导入 Token

如果你已经拿到了 `authToken`，也可以直接在页面里手动导入。

## 页面能力

### 1. 首面密码

如果配置了 `ACCESS_PASSWORD`，页面会先显示密码验证层：

- `POST /api/auth/access` 校验访问密码
- 校验通过后才展示主控制台

### 2. 多账号轮询

前端会把本地账号池作为 `accounts` 传给接口，后端支持：

- `rotationStrategy: "round_robin"`：轮询账号
- `rotationStrategy: "fixed"`：固定账号
- `accountIndex`：固定账号模式下使用的账号索引

## 部署到 Vercel

```bash
vercel
```

## 当前限制

- `stream: true` 暂未支持
- 账号池默认保存在浏览器 `localStorage`
- 首面密码是应用层保护，不是完整用户系统
- Bookmarklet 仍依赖 `freebuff.com` 登录后页面具备有效会话
- Serverless 的内存轮询计数与 `runId` 缓存不是强持久的，冷启动后会重新计数
