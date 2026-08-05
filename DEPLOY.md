# DreamTell Daily 独立部署与生产修复说明

本目录只部署 DreamTell Daily。不要把它与 DreamBridge Check-in 合并，也不要共用另一个项目的 `vercel.json`、API 路由或 Vercel Root Directory。

## Supabase

`supabase-schema.sql` 只用于全新、空的 Supabase 项目。若生产 `daily_entries` 已经存在并包含数据，不要重新执行整份 schema，也不要删除、重建、清空或替换生产表。

对现有生产表只核对字段、数据类型、`UNIQUE (participant_id, entry_date)` 和 RLS 状态。若缺少其中某项，先备份，再只执行修复该项所需的最小范围 SQL。该 schema 不创建 anon 读取或写入策略；浏览器只请求 Vercel API，数据库读写由服务器专用 service-role key 完成。

本次 `42501` 修复本身不需要重建数据库表。生产日志中的 `new row violates row-level security policy` 说明此前 anon/publishable 角色的 insert 被 RLS 拒绝。

## Vercel 环境变量

在 Daily 项目的 Vercel **Project Settings → Environment Variables** 添加：

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
DEEPSEEK_API_KEY
ADMIN_PASSWORD
```

- 四个变量的作用域都必须包含 **Production**。
- `SUPABASE_SERVICE_ROLE_KEY` 是服务器秘密，不得使用 `NEXT_PUBLIC_`、`VITE_` 等前缀，不得放进 `public/`、GitHub、HTML、日志或客户端 JavaScript。
- `ADMIN_PASSWORD` 应设置为新的强密码；管理页不包含或保存它，只在当前页面会话中随管理请求发送。
- `DEEPSEEK_API_KEY` 仅供 `api/daily-submit.js` 调用标签服务。缺失、超时或调用失败时问卷数据仍会保存；写入 `ai_processed=false`、`manual_review=true`，并使用系统回退标签值。
- 不再使用 `SUPABASE_ANON_KEY` 执行服务器数据库操作。

变量保存后必须对当前项目执行 **Redeploy**。无需新建 Vercel Project；现有 Daily URL 和 Check-in URL 都保持各自独立。

## 路由

- `/` → `public/index.html`
- `/api/daily-submit` → `api/daily-submit.js`
- `/api/admin-data` → `api/admin-data.js`
- `/admin` → `public/admin.html`（由 `vercel.json` rewrite）

前端实际提交 URL 是 `/api/daily-submit`，不是 `/api/submit`。

## 本地与生产验证

本地先运行：

```bash
npm test
```

生产验证清单：

1. 确认以上环境变量已保存到 Production，并 Redeploy 当前 Daily 项目。
2. 使用新的测试 participant ID，例如 `TEST-RLS-001` 完成一次 Daily 提交。
3. 页面显示现有成功页。
4. Supabase `daily_entries` 出现一条新记录，日期为测试设备的本地日期。
5. Supabase 日志不再出现该请求对应的 `42501`。
6. `/admin` 使用 `ADMIN_PASSWORD` 能读取该记录。
7. 同一 participant ID 当天再次提交，页面显示现有“今天已提交”提示。
8. 验证完成后从 Supabase 删除 `TEST-RLS-001` 测试记录。

Supabase 免费项目如已暂停，需要先 Resume；但本次核心生产错误是 `42501` RLS violation，不能把项目暂停当作唯一原因。不要把任何 secret 提交到 GitHub。
