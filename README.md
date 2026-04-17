# Freebuff2API Web

这是一个可直接部署到 `Vercel` 的 Web 版本，支持：

- 首面访问密码
- 多账号池
- 固定账号 / 轮询账号调用
- Web 登录兜底链接
- 手动导入 `authToken`
- OpenAI 风格接口：`/api/v1/chat/completions`

## 环境变量

- `DEFAULT_MODEL`: 选填，默认模型名
- `ACCESS_PASSWORD`: 选填，设置后首页会先要求输入访问密码

## 推荐登录方式

### 方案 A：网页登录

页面点击“新增 GitHub 登录账号”后，会尝试走 Freebuff 登录流程。

注意：如果登录页提示 `Login successful! Return to your terminal to continue.`，说明这个流程更偏向本地 CLI 场景，在 `Vercel` 云端轮询时可能返回 `401 Authentication failed`。

### 方案 B：浏览器控制台提取 Token（推荐）

当你已经在 `https://freebuff.com/` 登录成功后：

1. 打开 `freebuff.com` 对应页面
2. 打开浏览器开发者工具 Console
3. 复制执行 `browser-token-helper.js:1` 的全部内容
4. 如果脚本直接找到候选 token，会打印表格
5. 执行：

```js
copyFreebuffToken(0)
```

6. 回到你的 Web 控制台，把复制出的 token 粘贴到“手动导入账号”里

如果第一次没找到 token，可以继续执行：

```js
enableNetworkCapture()
```

然后刷新 `freebuff.com` 页面，脚本会尝试从请求头里的 `Authorization` 抓取 token。

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
- Serverless 的内存轮询计数与 `runId` 缓存不是强持久的，冷启动后会重新计数
