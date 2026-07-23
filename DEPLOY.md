# 部署说明（两个项目通用）

## 准备工作（一次性，20分钟）

### 1. 注册 Supabase

去 https://supabase.com → 注册 → New Project

**Check-in 问卷** 运行这个 SQL：
```sql
CREATE TABLE checkin_responses (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  submitted_at    TIMESTAMPTZ DEFAULT NOW(),
  lang            TEXT,
  source          TEXT,
  grade           TEXT,
  stress_source   TEXT,
  stress_freq     TEXT,
  cant_stop_freq  TEXT,
  sleep_hours     TEXT,
  sleep_diff_freq TEXT,
  morning_feel    TEXT,
  stress_symptoms TEXT[],
  sleep_factors   TEXT[],
  guide_content   TEXT[],
  support_form    TEXT[],
  open_response   TEXT,
  activity_help   TEXT,
  try_advice      TEXT,
  which_advice    TEXT
);
```

**DreamTell 日记** 运行这个 SQL：
```sql
CREATE TABLE daily_entries (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  submitted_at          TIMESTAMPTZ DEFAULT NOW(),
  participant_id        TEXT NOT NULL,
  entry_date            DATE NOT NULL,
  wave                  TEXT,
  lang                  TEXT,
  bedtime               TEXT,
  wake_time             TEXT,
  sleep_quality         INTEGER,
  sleep_latency         TEXT,
  night_awakenings      TEXT,
  unresolved_mind       TEXT,
  unresolved_categories TEXT[],
  dream_recall          TEXT,
  dream_text_raw        TEXT,
  stress_level          INTEGER,
  stress_causes         TEXT[],
  stress_vs_avg         TEXT,
  mental_health         INTEGER,
  ai_themes             TEXT[],
  ai_emotions           TEXT[],
  ai_tone               TEXT,
  ai_confidence         NUMERIC(3,2),
  ai_notes              TEXT,
  ai_processed          BOOLEAN DEFAULT FALSE,
  manual_review         BOOLEAN DEFAULT FALSE,
  UNIQUE (participant_id, entry_date)
);
```

在 Supabase → Settings → API 里找到：
- **Project URL** → 记下
- **anon public key** → 记下

---

### 2. 注册 DeepSeek（仅 DreamTell 需要）

去 https://platform.deepseek.com → 注册 → API Keys → 创建一个

充值 10 元人民币，够用几个月。

---

### 3. 注册 GitHub

去 https://github.com → 注册

---

## 部署步骤（每个项目各做一次）

### Step 1：上传代码到 GitHub

1. GitHub → New repository
2. 名字随意，比如 `dreambridge-checkin` 或 `dreamtell-daily`
3. Public，不初始化
4. 在本地解压 zip 文件
5. 在解压后的文件夹里运行：

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/你的用户名/仓库名.git
git push -u origin main
```

### Step 2：部署到 Vercel

1. 去 https://vercel.com → 用 GitHub 登录
2. New Project → 选你刚创建的 repo → Import
3. 点 Environment Variables，添加：

**Check-in 问卷需要：**
```
SUPABASE_URL        = 你的 Supabase URL
SUPABASE_ANON_KEY   = 你的 Supabase anon key
ADMIN_PASSWORD      = Chrisgogogo
```

**DreamTell 日记需要：**
```
SUPABASE_URL        = 你的 Supabase URL
SUPABASE_ANON_KEY   = 你的 Supabase anon key
DEEPSEEK_API_KEY    = 你的 DeepSeek API key
ADMIN_PASSWORD      = Chrisgogogo
```

4. 点 Deploy → 等1-2分钟

### Step 3：确认部署成功

Vercel 会给你一个 URL，比如 `https://dreambridge-checkin.vercel.app`

测试：
- 打开 `https://你的域名.vercel.app` → 看到问卷
- 打开 `https://你的域名.vercel.app/admin` → 输入密码 `Chrisgogogo` → 看到管理页

---

## 区分多场 workshop（Check-in 用）

不同场次用不同 URL：
```
第一场：https://你的域名.vercel.app?source=session1
第二场：https://你的域名.vercel.app?source=session2
```

Admin 页会自动显示按来源筛选的按钮。

---

## DreamTell 参与者 ID 分配方式

建议按学校分配：
```
Middlesex: MS-001, MS-002, MS-003 ...
SAGES:     SG-001, SG-002, SG-003 ...
上海学校:   SH-001, SH-002, SH-003 ...
```

发给每位参与者时说：
> 你的代码是 MS-007。打开网址，第一次输入这个代码，之后每天自动记住。全程匿名。

---

## 常见问题

**Q: 提交后 Supabase 没有数据**
检查 Vercel 的环境变量是否填写正确（有没有多余空格）

**Q: /admin 打开是空白**
等几秒，Vercel serverless function 冷启动需要时间

**Q: China 访问很慢**
Vercel 有时在中国访问慢，但通常可以。如果实在不行，告诉我，换方案。

**Q: DeepSeek 标记失败**
日记仍然会正常保存，只是 `ai_processed=false`。后面可以批量重新标记。
