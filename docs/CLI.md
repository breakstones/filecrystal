# filecrystal CLI 参考手册

通用文件解析命令行工具:把 PDF / 图片 / Excel / Word 文件,经过 OCR + LLM 转成 Markdown 或结构化 JSON。

两个子命令:

| 子命令 | 作用 | 产出 |
|---|---|---|
| [`extract`](#1-extract) | 文件 → Markdown(OCR + 可选印章签名识别) | 每个输入一份 `.md` + stdout 的 JSON summary |
| [`structure`](#2-structure) | Markdown / 原始文件 → LLM 字段抽取 | stdout JSON(prompt 作者自定义 schema) |

```
┌────────────────┐     ┌─────────────────────┐
│ filecrystal    │     │ filecrystal         │
│ extract        │ ──▶ │ structure           │
│ → Markdown     │     │ → prompt-defined    │
│   (.md 文件)   │     │   JSON              │
└────────────────┘     └─────────────────────┘
```

---

## 通用基础

### 安装 / 运行

```bash
pnpm install
pnpm build
node dist/cli.js <command> ...        # 开发路径
npx filecrystal <command> ...         # 发布后
```

### 环境变量

统一命名规范:
- `FILECRYSTAL_MODEL_*` — 模型服务凭据
- `FILECRYSTAL_<DOMAIN>_MODEL` — 具体模型名(DOMAIN = `VISION` 或 `TEXT`)
- `FILECRYSTAL_<DOMAIN>_MODEL_THINKING` — 对应 domain 的 Qwen3 思考开关
- 非模型运行时变量保留原命名空间

**模型凭据**(必需):

| 变量 | 作用 | 默认 |
|---|---|---|
| `FILECRYSTAL_MODEL_BASE_URL` | OpenAI-compatible base URL | `https://dashscope.aliyuncs.com/compatible-mode/v1`(百炼) |
| `FILECRYSTAL_MODEL_API_KEY` | API Key | — 必填,缺失时报错 |

**模型选择**(可选):

| 变量 | 作用 | 默认 |
|---|---|---|
| `FILECRYSTAL_VISION_MODEL` | OCR + 印章签名识别统一 vision 模型 | `qwen-vl-ocr-latest` |
| `FILECRYSTAL_TEXT_MODEL` | `structure` 阶段的文本模型 | `qwen3.6-plus` |

**思考模式**(独立控制,默认全部关闭):

| 变量 | 影响 | 默认 |
|---|---|---|
| `FILECRYSTAL_VISION_MODEL_THINKING` | `true` → 给 vision 请求加 `enable_thinking: true` | `false` |
| `FILECRYSTAL_TEXT_MODEL_THINKING` | `true` → 给 text/structure 请求加 `enable_thinking: true` | `false` |

> 思考模式会显著增加延迟和 token 消耗,对 OCR 类任务通常无益;仅在处理需要复杂推理的文本抽取时考虑开启 `FILECRYSTAL_TEXT_MODEL_THINKING`。

**运行时**(非模型相关):

| 变量 | 作用 | 默认 |
|---|---|---|
| `FILECRYSTAL_CACHE_DIR` | 本地缓存目录 | `<tmpdir>/filecrystal-cache` |
| `UV_THREADPOOL_SIZE` | Node libuv 线程池大小;建议 `16`,加速 canvas/sharp 预处理 | `4`(Node 默认) |

### CLI 只走真实 API

CLI 没有 mock 模式;缺凭据直接报错。需要离线单测时通过库 API `createFileParser({ mode: 'mock' })`。

### 退出码

| code | 含义 |
|---|---|
| `0` | 全部成功 |
| `3` | `extract`:至少 1 个文件 failed,其它成功 |
| `1` | 其他致命错误(参数/IO/配置/缺凭据) |

---

## 1. `extract`

> **把一批文件解析成 Markdown 文件**。多文件并发,每个输入产出一份 `.md`。

### 1.1 用法

```bash
filecrystal extract <paths...> [options]
```

### 1.2 位置参数

| 参数 | 说明 |
|---|---|
| `<paths...>` | 一个或多个文件路径。Windows 中文路径用双引号。 |

**接受的输入类型**:

| 类型 | 扩展名 | 处理方式 |
|---|---|---|
| 需解析 | `pdf` · `jpg` / `jpeg` · `png` · `xlsx` · `xls` · `docx` · `doc` | 走 OCR/xlsx/docx 管线,产出 `.md` |
| 文本直通 | `md` · `markdown` · `txt` | **不解析**,直接在 `items[]` 标记 `message: "Already a text file"`,用户按原路径读取 |
| 压缩包 | `zip` | 解压到同目录的**同名子目录**(`docs/bundle.zip` → `docs/bundle/`),里面的文件按上述两类再分别处理。嵌套 zip 会落盘但**不递归**,附上 warning。 |

输入可**任意混合**,例如:`filecrystal extract a.pdf notes.md bundle.zip`。顺序保持用户传入顺序,zip 内的 entry 以文件名字母序追加在其父 zip 之后。

### 1.3 选项

| 选项 | 可选值 | 默认 |
|---|---|---|
| `--out <dir>` | 任意目录路径 | 每个输入文件的原目录(即 `a/b/x.pdf` → `a/b/x.md`) |
| `--concurrency <n>` | 正整数 | `min(<输入文件数>, 10)` |
| `--base-url <url>` | 任意 OpenAI-compatible base URL | env `FILECRYSTAL_MODEL_BASE_URL` |
| `--api-key <key>` | 任意 API key | env `FILECRYSTAL_MODEL_API_KEY` |
| `--vision-model <model>` | `qwen-vl-ocr-latest` / `qwen-vl-plus` / `qwen-vl-max` / `qwen3-vl-plus` / ... | `qwen-vl-ocr-latest` |
| `--full-pages` | 开关 | off(启用头尾截断) |
| `--force` | 开关 | off(使用缓存) |
| `--no-detect-seals` | 开关 | off(默认进行印章签名识别) |

`--full-pages`:关闭 "头尾截断" 策略(默认只保留前 N + 末 M 页,见 §3 性能参数)。处理完整长文档必用。

`--force`:跳过磁盘缓存。默认缓存键是 `(文件内容 hash, 配置 fingerprint, prompt hash)`,重复调用零延迟零费用。

`--no-detect-seals`:关闭印章/签名识别,速度更快、成本更低;丢失 Markdown 中的 `【印章:...】` / `【签名:...】` 内嵌标记。

### 1.4 输出

#### `.md` 文件

每个输入产出一个同名 `.md`(扩展名替换),内容是 Markdown 正文:

```markdown
# 对公账户证明.PDF

## Page 1

# 证明

账户信息如下:

- 公司名称:XX 工程有限公司
- 开户行:XX 银行 XX 支行
- 账号:0000 0000 0000 0000 0000

【印章:XX 工程有限公司 | 颜色:红 | 形状:圆形】
```

格式规则:

| 输入类型 | Markdown 输出 |
|---|---|
| PDF | 每页 `## Page N` + 模型返回的 Markdown 正文 |
| XLSX 密集表格(cells/行 ≥ 2,行列均 ≥ 2) | `\| col \| col \|` 管道表格 |
| XLSX 稀疏(document-in-xlsx) | `- **A1**: 值` 列表 |
| DOCX | `sections` 连续段落 |
| 图片 | 模型返回的 Markdown 正文 |

印章/签名以 `【印章:单位 \| 颜色 \| 形状】`、`【签名:姓名】` 内嵌在正文原位置。

#### stdout summary(pretty-print JSON)

```json
{
  "total": 5,
  "ok": 4,
  "failed": 1,
  "totalMs": 28345,
  "archives": [
    {
      "archive": "docs/bundle.zip",
      "extractedDir": "docs/bundle",
      "expanded": 2,
      "passthrough": 1,
      "warnings": ["nested archive docs/bundle/inner.zip was not recursed"]
    }
  ],
  "items": [
    { "path": "docs/合同.pdf",          "ok": true,  "durationMs": 23218, "outFile": "docs/合同.md" },
    { "path": "docs/notes.md",          "ok": true,  "durationMs": 0,     "message": "Already a text file" },
    { "path": "docs/bundle/readme.txt", "ok": true,  "durationMs": 0,     "message": "Already a text file" },
    { "path": "docs/bundle/data.xlsx",  "ok": true,  "durationMs": 234,   "outFile": "docs/bundle/data.md" },
    { "path": "docs/bundle/bad.pdf",    "ok": false, "durationMs": 30041, "error": "OCR response has no content", "code": "OCR_FAILED" }
  ]
}
```

字段说明:
- `archives`:仅当输入含 `.zip` 时出现;每条记录对应一个源 zip,含解压目标、可解析数量、文本直通数量、warnings(嵌套 zip 等)。
- `items[].message`:仅文本直通条目(`.md` / `.markdown` / `.txt`)会带此字段;这类条目不会有 `outFile`,因为不重写。
- `items[].outFile`:正常解析条目(写到 `<stem>.md`)才有。
- 条目顺序:用户原输入顺序 → 每个 zip 内部字母序。

### 1.5 示例

```bash
# 1) 同目录就地生成 .md(默认行为)
node dist/cli.js extract docs/合同.pdf docs/请款.xls
# → docs/合同.md
# → docs/请款.md

# 2) 写到指定目录
node dist/cli.js extract docs/*.pdf --out out/markdown/

# 3) 印章精度优先
node dist/cli.js extract docs/合同.pdf --vision-model qwen3-vl-plus

# 4) 速度优先,关印章
node dist/cli.js extract docs/*.pdf --no-detect-seals

# 5) 处理长文档,关头尾截断
node dist/cli.js extract docs/长合同.pdf --full-pages

# 6) zip 输入:解压到 docs/bundle/ ,然后批量解析里面的支持格式
node dist/cli.js extract docs/bundle.zip

# 7) 混合输入:pdf + md + zip(md 直通,pdf 和 zip 内容走解析)
node dist/cli.js extract docs/合同.pdf docs/notes.md docs/bundle.zip

# 8) 只传文本文件:不调 OCR/LLM,秒返回
node dist/cli.js extract docs/README.md docs/CHANGELOG.md

# 6) 结合环境变量
FILECRYSTAL_VISION_MODEL=qwen-vl-plus \
  node dist/cli.js extract docs/*.pdf
```

---

## 2. `structure`

> **用 LLM prompt 从文档中抽字段**。`extracted` 字段 **直接遵循 prompt 要求的 JSON 结构**(原样透传);无法解析成 JSON 时自动降级为 `{ "text": "..." }`。
>
> **工作模型**:structure **不再自己调 `parser.parse`**。所有输入先变成 Markdown 文本——文本文件直通,原始文件内部走 `extract` 管线,`.zip` 透明展开——然后按**用户输入顺序**拼成一个 prompt 送 LLM。默认**单次 LLM 调用**,仅当合并后文本超过 `--max-input-chars`(默认 `500_000`)时才分批→浅合并。

### 2.1 用法

```bash
filecrystal structure <inputs...> [options]
```

### 2.2 位置参数

| 参数 | 说明 |
|---|---|
| `<inputs...>` | 一个或多个路径:`.md` / `.markdown` / `.txt`(extract 产物,直通不解析)或原始文件(pdf/xlsx/docx/... 自动先走 extract 转成 Markdown)或 `.zip`(展开到同名子目录再按上述两类处理)。可混用;按用户输入顺序拼接送 LLM。 |

### 2.3 选项

| 选项 | 可选值 | 默认 |
|---|---|---|
| `--prompt <file>` | prompt 文件路径(Markdown + YAML frontmatter)。与 `--prompt-text` 互斥。 | 缺省使用内置默认 prompt |
| `--prompt-text <string>` | 直接作为 prompt 内容的字符串(命令行内联)。与 `--prompt` 互斥。 | 同上 |
| `--max-input-chars <n>` | 正整数。合并后的文本超此值才触发切批 + 浅合并。默认不触发,整体单次 LLM 调用。 | `500000` |
| `--concurrency <n>` | 正整数。传入原始文件时并发 extract 的文件数。 | `3` |
| `--base-url <url>` | 任意 URL | env `FILECRYSTAL_MODEL_BASE_URL` |
| `--api-key <key>` | 任意 API key | env `FILECRYSTAL_MODEL_API_KEY` |
| `--text-model <model>` | `qwen3.6-plus` / `qwen-plus` / `qwen-max` / `qwen3-plus` / ... | `qwen3.6-plus` |
| `--vision-model <model>` | `qwen-vl-ocr-latest` / `qwen-vl-plus` / ... | `qwen-vl-ocr-latest` |
| `--full-pages` | 开关,仅在需要先 extract 原始文件时生效 | off |
| `--no-detect-seals` | 开关,同上 | off |

### 2.4 输出结构(stdout,pretty-print JSON)

```json
{
  "inputs": [
    { "path": "docs/合同.md", "kind": "passthrough" }
  ],
  "promptName": "contract-document",
  "batches": [
    {
      "sources": 1,
      "chars": 6017,
      "llmMs": 8944,
      "promptTokens": 4017,
      "completionTokens": 376
    }
  ],
  "totalLlmMs": 8944,
  "tokenUsage": { "prompt": 4017, "completion": 376 },
  "warnings": [],
  "extracted": { /* ← 直接是 prompt 要求的 JSON 形状 */ }
}
```

其中 `inputs[i].kind` 取值:
- `passthrough`:输入是 `.md` / `.markdown` / `.txt`,内容直接读取
- `parsed`:输入是原始 pdf/xlsx/docx/image/...,内部调用 extract 管线转成 Markdown 后再拼接

额外字段:
- `archives`:仅当输入含 `.zip` 时出现,与 `extract` 命令同构
- `parseFailures`:仅当有原始文件解析失败或 zip 展开失败时出现;失败条目不会被送入 LLM,但进程 exit code = 3

### 2.5 `extracted` 的形态(最重要)

`extracted` 的结构 **100% 由 prompt 决定**,CLI 不做二次转换。

#### A · prompt 要求简单扁平 schema

prompt 片段:
```
以 JSON 输出: {"company":"...", "bank":"...", "account":"..."}
```

输出:
```json
{
  "extracted": {
    "company": "XX 工程有限公司",
    "bank":    "XX 银行 XX 支行",
    "account": "0000 0000 0000 0000 0000"
  }
}
```

#### B · prompt 要求带 metadata 的 schema

prompt 片段:
```
{ "payeeName": { "value": "string", "confidence": 0.0, "locator_hint": "string" } }
```

输出:
```json
{
  "extracted": {
    "payeeName": {
      "value": "XX 工程有限公司",
      "confidence": 0.98,
      "locator_hint": "Page 1 中 '公司名称:' 后紧跟的文本"
    }
  }
}
```

> **注意**:`locator_hint` 原字段名保留(CLI 不再做 snake_case→camelCase 转换)。

#### C · 模型返回非 JSON(降级兜底)

当 LLM 返回散文、或 JSON 修复失败时,CLI **不抛错**,而是:

1. 先尝试 JSON-fix:剥 ```` ``` ```` 围栏、修 trailing comma、修智能引号/单引号、剥叙事性前后缀;
2. 仍失败就降级 `{ "text": "<raw model output>" }`,并在 `warnings` 标注。

```json
{
  "warnings": ["at least one batch returned non-JSON content; see `extracted.text`"],
  "extracted": { "text": "对不起,我没办法识别..." }
}
```

### 2.6 Prompt 文件格式

Markdown + YAML frontmatter:

````markdown
---
name: account-certificate         # 可选,显示在 promptName
model: qwen3.6-plus               # 可选,覆盖 --text-model
temperature: 0.1                  # 可选,默认 0.1
thinking: true                    # 可选,覆盖 FILECRYSTAL_TEXT_MODEL_THINKING
---

# 角色
你是信息抽取助手,从文档中抽取:公司名、开户行、账号。

# 输出 JSON Schema
```json
{
  "company": "string",
  "bank":    "string",
  "account": "string"
}
```

# 注意
- `account` 去掉所有空格
````

**Frontmatter 字段优先级**:

| 字段 | 来源优先级(高 → 低) |
|---|---|
| `model` | `frontmatter.model` > `--text-model` > env `FILECRYSTAL_TEXT_MODEL` > 默认 `qwen3.6-plus` |
| `temperature` | `frontmatter.temperature` > 配置 `extraction.defaultTemperature` > 默认 `0.1` |
| `thinking` | `frontmatter.thinking` > env `FILECRYSTAL_TEXT_MODEL_THINKING` > 默认 `false` |

`thinking: false` 在 prompt 里会显式关闭思考模式,即使 env 默认开启 — 让你对某个特定 prompt 单独关掉推理而不影响其他 prompt。

内置 4 个示例在 [`scripts/prompts/`](../scripts/prompts):
- `contract.prompt.md` — 工程合同关键字段
- `payment-summary.prompt.md` — 付款请款表
- `account-certificate.prompt.md` — 对公账户证明
- `generic.prompt.md` — 通用兜底

### 2.7 示例

```bash
# 1) 内联 prompt
node dist/cli.js structure docs/合同.md \
  --prompt-text '输出 JSON: {"contractName":"...", "amount":0}'

# 2) 文件 prompt(推荐,可版本化)
node dist/cli.js structure docs/合同.md \
  --prompt scripts/prompts/contract.prompt.md

# 3) 跨文件合并抽取(两源合并成一次 LLM 调用)
node dist/cli.js structure \
  docs/汇总.md docs/请款.xls.md \
  --prompt scripts/prompts/payment-summary.prompt.md

# 4) 两阶段合用(推荐生产管线:一次 OCR,多次试 prompt)
node dist/cli.js extract docs/*.pdf --out out/
node dist/cli.js structure out/*.md --prompt v1.prompt.md > v1.json
node dist/cli.js structure out/*.md --prompt v2.prompt.md > v2.json

# 5) 直接喂原始文件(自动先 extract)
node dist/cli.js structure docs/合同.pdf \
  --prompt scripts/prompts/contract.prompt.md
```

---

## 附录 A · 错误码

| code | 场景 |
|---|---|
| `FILE_NOT_FOUND` | stat 失败 |
| `UNSUPPORTED_FORMAT` | 格式不支持,或 `.doc` 旧版解析失败 |
| `OCR_FAILED` | OCR 返回空内容或两次 hedge 均 timeout |
| `LLM_JSON_PARSE` | LLM 返回空内容(现在 JSON 解析失败会 fallback 到 `{text}`,不抛此错) |
| `CONFIG_INVALID` | 配置或 zod 校验失败(如缺 API 凭据) |
| `CACHE_IO` | 缓存读写失败(非致命,仅记录 warning) |

失败条目出现在 `items[]`:

```json
{ "path": "x.pdf", "ok": false, "error": "OCR response has no content", "code": "OCR_FAILED" }
```

## 附录 B · 常见组合速查

| 场景 | 命令 |
|---|---|
| 就地批量生成 Markdown | `extract *.pdf` |
| 统一收口到一个目录 | `extract *.pdf --out out/` |
| 印章签名识别优先精度 | `extract a.pdf --vision-model qwen3-vl-plus` |
| 速度优先,关印章检测 | `extract *.pdf --no-detect-seals` |
| 一次 OCR 多次试 prompt | `extract *.pdf --out out/` → `structure out/*.md --prompt p1.md` |
| 简短一次性抽取 | `structure a.md --prompt-text '输出 JSON: {"x":"..."}'` |
| 需要推理的复杂字段抽取 | `FILECRYSTAL_TEXT_MODEL_THINKING=true ... structure ...` |

## 附录 C · 性能参数速查

| 位置 | 默认值 | 说明 |
|---|---|---|
| `extract --concurrency` | `min(files, 10)` | 文件级并发 |
| `ocr.maxConcurrency` | `18` | 进程全局 OCR 并发 |
| `ocr.timeoutMs` | `45000` | 单次 OCR 请求超时 |
| `ocr.retries` | `2` | 单次失败后最多重试次数 |
| `ocr.imageMaxLongEdge` | `2000` | `sharp` 缩放长边上限(px) |
| `ocr.speculativeAfterMs` | `8000` | hedged-fetch 第二次请求的触发延迟 |
| `structure.maxInputChars` | `500000` | 合并后文本超此值才触发切批 + 浅合并;默认走单次 LLM 调用 |
| `truncation.maxPages` | `10` | PDF 保留前 N + 后 M 页 |
| `truncation.headTailRatio` | `[7, 3]` | 头尾比例 |
| `truncation.docxMaxChars` | `5000` | docx 正文截断 |

上述参数仅可通过库 API(`FileParserConfig`)调整,CLI 层不暴露。
