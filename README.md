# 邓邓的自动招聘看板

一个不依赖 Codex 的公开招聘看板。网页可以直接复制到其他电脑打开，也可以部署到 GitHub Pages；GitHub Actions 每天自动检查链接、发现公开岗位、去重、筛选并重新发布。网页右上角提供“刷新最新数据”按钮，岗位详情支持加入当前浏览器的私有投递队列。

## 当前规则

- 岗位方向：运营、内容、市场、营销、增长、销售、商务、BD、GTM、客户与渠道。
- 国内目标城市：上海、青岛、宁波。
- Bonjour：只保留上海或明确支持远程的职位。
- 海外：保留远程及配置中列出的目标国家和地区。
- 排除 LinkedIn。
- 404/410 当次下架；网络超时或临时错误连续 3 次才隐藏。
- 401/403/429 记录为官网保护状态，不直接判定失效。
- 只做公开岗位发现与链接监控，不登录、不绕过验证码、不自动提交申请。

## 在任意电脑打开

下载整个项目文件夹，双击 `index.html`。岗位数据通过 `data/jobs.js` 加载，因此不需要安装 Codex，也不需要本地服务器。打开企业招聘链接需要联网。

也可以启动本地服务器：

```bash
npm run serve
```

然后访问 `http://127.0.0.1:4173`。

## 手动刷新

需要 Node.js 20 或更高版本：

```bash
npm run refresh
npm run check
```

刷新结果会写入：

- `data/jobs.js`：公开岗位数据。
- `data/run-status.js`：最近一次运行状态。

## 网页里的刷新按钮

- `刷新最新数据`：立即跳过浏览器缓存，重新读取网站上刚发布的岗位数据。在本地双击打开时，它会重新读取本地 `data` 文件。
- `运行岗位搜索`：部署到 GitHub Pages 后自动出现，进入当前仓库的 GitHub Actions 页面。仓库所有者可以点 `Run workflow`，随时运行一次完整搜索、链接检测和网站发布。

两者作用不同：公开静态网页不能安全保存 GitHub 密钥，所以“刷新最新数据”不会在访客浏览器里偷偷运行爬虫；完整搜索由受 GitHub 登录保护的 Actions 工作流执行。运行完成后回到看板，点击“刷新最新数据”即可看到结果。

## 私有投递队列

- 在岗位详情中点击“加入私有投递队列”。
- 队列只保存岗位名称、链接和建议简历版本，保存在当前浏览器的本地存储中。
- 队列不会上传姓名、电话、邮箱、简历或申请记录，也不会进入公开仓库。
- 清除浏览器网站数据会同时清除队列；需要真正投递时，仍由本机私有 ApplyPilot 工作流处理并在最终提交前交由用户确认。

## 部署到 GitHub Pages

1. 在 GitHub 创建一个空仓库。
2. 将本目录中的全部文件提交到仓库的 `main` 分支。
3. 打开仓库 `Settings → Pages`，将发布来源选择为 `GitHub Actions`。
4. 打开 `Settings → Actions → General → Workflow permissions`，允许工作流读写仓库内容。
5. 在 `Actions` 页面手动运行一次 `Daily refresh and deploy`。
6. 部署完成后，GitHub Pages 会显示公开网址；以后每天北京时间 09:30 自动刷新。

公开网址通常是：

```text
https://你的GitHub用户名.github.io/仓库名/
```

首次部署和手动刷新可能需要等待约 1–3 分钟。公开网址可以在仓库 `Settings → Pages` 顶部复制。

工作流使用 GitHub 官方 Pages 部署流程：`configure-pages`、`upload-pages-artifact` 和 `deploy-pages`。

## 增加结构化 ATS 数据源

系统支持 Greenhouse、Lever 和 Ashby 的公开岗位接口。在 `config/search-rules.json` 的 `atsBoards` 数组中加入配置。格式参考 `config/ats-boards.example.json`。

示例：

```json
{
  "type": "greenhouse",
  "company": "Example Company",
  "token": "company-board-token",
  "ownership": "foreign",
  "enabled": true
}
```

未配置 ATS 时，系统仍会每天检查现有官网入口，并从允许抓取的 HTML、JSON-LD `JobPosting` 和公开职位链接中发现岗位。

## 隐私与开源

本目录可以公开，不包含真实姓名、电话、邮箱、简历、申请记录、账号、Cookie 或浏览器会话。不要把私人 ApplyPilot 目录、简历或 `candidate_profile.json` 复制进仓库。

使用 MIT License。企业名称和链接仅用于指向其公开招聘入口；岗位内容与商标归各自权利人所有。

## 自动搜索的边界

- JavaScript 重度渲染、登录墙、验证码和反爬页面可能无法自动发现新岗位。
- 系统遵守公开 `robots.txt`，被禁止的页面只保留人工入口，不抓取内容。
- “自动发现”不代表符合毕业时间、签证或工作授权要求，投递前仍需人工核验。
- 定时任务不会上传简历或提交申请。
