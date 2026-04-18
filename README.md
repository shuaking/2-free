# Freebuff2API Web

这是一个可直接部署到 `Vercel` 的 Web 版本，支持：

- 首面访问密码保护
- 多账号池管理（轮询/固定账号调用）
- Bookmarklet 书签脚本一键导入 token
- 快速手动导入（名称和邮箱可选）
- 一键快速测试功能
- 键盘快捷键支持
- OpenAI 风格接口：`/api/v1/chat/completions`

## 快速开始

1. **拖拽书签** - 将页面上的书签按钮拖到浏览器书签栏
2. **登录并点击** - 在 `freebuff.com` 登录后点击书签
3. **自动导入** - Token 自动回传并加入账号池，立即可用

## 环境变量

- `DEFAULT_MODEL`: 选填，默认模型名
- `ACCESS_PASSWORD`: 选填，设置后首页会先要求输入访问密码
- `BLOB_READ_WRITE_TOKEN`: 选填，配置后启用服务端账号池持久化

### 账号池持久化开关说明

- 配置了 `BLOB_READ_WRITE_TOKEN`：账号池保存到服务端（Vercel Blob），多设备可共享
- 未配置 `BLOB_READ_WRITE_TOKEN`：前端会退回本地缓存，仅当前浏览器可见

## 推荐使用流程

### ① 书签导入（推荐）

**最简单的方式，无需手动复制粘贴 Token**

1. 打开 Freebuff2API Web 页面
2. 将”拖拽到书签栏 →”按钮拖到浏览器书签栏（或点击”复制书签代码”手动创建）
3. 登录 `https://freebuff.com/` 并进入主应用页面
4. 点击刚才添加的书签
5. 自动跳回 Web 页面，Token 已导入账号池

**工作原理：**
- 书签脚本优先调用 `freebuff.com` 的 `/api/auth/cli/code` 和 `/api/auth/cli/status` 接口
- 如果成功获取 `user.authToken`，立即回传到你的 Web 页
- 如果接口不可用，退回到页面存储扫描模式

**提示：**
- 必须在登录后的业务页面点击书签，不要停在”Login successful”过渡页
- 书签栏快捷键：`Ctrl+Shift+B` (Windows) / `Cmd+Shift+B` (Mac)

### ② 快速手动导入

**适合已有 Token 的场景**

1. 直接粘贴 `authToken` 到输入框
2. 按 `Enter` 或点击”添加账号”
3. 名称和邮箱可选，系统会自动生成账号名

**键盘快捷键：**
- Token 输入框：`Enter` 快速提交
- 消息输入框：`Ctrl+Enter` / `Cmd+Enter` 发送请求

### ③ 快速测试

导入账号后，点击”发送测试消息”按钮，自动发送测试请求验证账号是否可用。

### 高级选项：GitHub OAuth 登录

点击”GitHub OAuth 登录”走完整登录流程。

**注意：** 如果登录页显示 `Return to your terminal to continue`，说明这是 CLI 优先流程，云端轮询可能失败。优先使用书签导入。

## 功能特性

### 访问密码保护

如果配置了 `ACCESS_PASSWORD` 环境变量，页面会先显示密码验证：
- 通过 `POST /api/auth/access` 校验访问密码
- 验证通过后才能进入主控制台
- 密码在当前会话中保持有效

### 多账号管理

- **账号池管理**：本地存储多个账号，实时显示账号数量
- **轮询模式**：自动在多个账号间轮流调用，分散请求压力
- **固定账号模式**：指定使用某个特定账号
- **账号去重**：相同邮箱的账号自动合并更新

### 键盘快捷键

- `Enter`：Token 输入框快速提交
- `Ctrl+Enter` / `Cmd+Enter`：发送聊天请求
- `Ctrl+Shift+B` / `Cmd+Shift+B`：显示/隐藏书签栏

### 快速测试

点击"发送测试消息"按钮，自动发送预设测试消息验证账号可用性。

## API 接口

### OpenAI 兼容接口

`POST /api/v1/chat/completions`

**请求参数：**
```json
{
  "model": "deepseek-chat",
  "messages": [{"role": "user", "content": "你好"}],
  "stream": false,
  "rotationStrategy": "round_robin",
  "accountIndex": 0,
  "accounts": [...],
  "accessPassword": "your-password"
}
```

**响应格式：**
```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "你好！我是..."
    }
  }],
  "account": {
    "strategy": "round_robin",
    "index": 0,
    "email": "user@example.com"
  }
}
```

### 其他接口

- `GET /api/v1/models` - 获取可用模型列表
- `POST /api/auth/access` - 验证访问密码
- `POST /api/auth/login/start` - 启动 GitHub OAuth 登录
- `GET /api/auth/login/status` - 轮询登录状态
- `GET /api/health` - 健康检查
- `GET /api/accounts` - 读取服务端账号池
- `POST /api/accounts` - 覆盖保存服务端账号池
- `DELETE /api/accounts` - 清空服务端账号池

### 持久化状态验证（推荐）

1. 先访问 `GET /api/health`，确认：
   - `accountStorage: "vercel-blob"`
   - `blobConfigured: true`
2. 在页面新增一个账号后，访问 `GET /api/accounts`：
   - 能看到新增账号，说明已写入服务端
3. 换浏览器或无痕模式再打开页面：
   - 账号仍存在，说明持久化生效

## 部署到 Vercel

```bash
vercel
```

**环境变量配置：**
- `DEFAULT_MODEL`（可选）：默认模型名称
- `ACCESS_PASSWORD`（可选）：首页访问密码，设置后需要验证才能进入
- `BLOB_READ_WRITE_TOKEN`（可选）：服务端账号池持久化

> 注意：新增 `@vercel/blob` 依赖后，需要重新部署一次，旧部署不会自动启用服务端账号池。

## 技术栈

- 纯静态 HTML + JavaScript（无构建步骤）
- Vercel Serverless Functions（API 路由）
- Vercel Blob（账号池服务端持久化）
- localStorage（服务不可用时本地兜底）
- Bookmarklet（跨域 Token 回传）

## 当前限制

- **流式响应**：`stream: true` 暂未支持
- **账号持久化**：配置 `BLOB_READ_WRITE_TOKEN` 后保存在服务端，未配置时退回本地缓存
- **访问控制**：首页密码是应用层保护，不是完整的用户权限系统
- **登录依赖**：Bookmarklet 依赖 `freebuff.com` 的有效登录会话
- **Serverless 限制**：轮询计数和 `runId` 缓存在冷启动后会重置

## 安全建议

- 生产环境务必设置 `ACCESS_PASSWORD`
- 定期更换访问密码
- 不要在公共网络环境下使用
- Token 仅存储在本地浏览器，不会上传到服务器
