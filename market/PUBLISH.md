# 发布到 DSH 插件市场（awesome-dsh-plugin / dshmarket）

结论：插件市场**不接受直接上传压缩包**。它的条目指向一个 GitHub 仓库，安装也要求来源在该精选目录里。所以要发布，必须先有 GitHub 仓库，再往 registry 提一个 YAML 条目 PR。

## 前置
- GitHub 账号，以及一个有 `repo` 权限的 Personal Access Token（或在本机 `git` 里配好的凭据）
- 插件包本身已满足要求：`package.json` 里有 `dsh.bundle.patch`（本仓库有）和无运行时依赖（本仓库有）

## 第 1 步：把插件推成一个公开 GitHub 仓库

在本目录（`dsh-node-monitor/`）执行：

```bash
git init -b main
git add .
git -c user.name="OWNER" -c user.email="you@example.com" commit -m "dsh-node-monitor v0.3.1"
# 先在 GitHub 网页建空仓库 dsh-node-monitor（不要勾 README），然后：
git remote add origin https://github.com/OWNER/dsh-node-monitor.git
git push -u origin main
```

> 不要把 `*.tgz`、测试用临时文件、`~/.dsh` 数据提交进去；`.gitignore` 已排除。

## 第 2 步：给 registry 提一个文件

Fork `https://github.com/awesome-dsh-plugin/awesome-dsh-plugin`，加入唯一一个文件：

`data/plugins/OWNER__dsh-node-monitor.yml`（内容见 `market/entry.yml`，替换 OWNER）

然后提 PR，标题 `add: OWNER/dsh-node-monitor`，正文用 `market/PR.md` 里的内容。合并后市场通常一天内收录。

## 第 3 步（可选）：同时发 npm

市场条目虽然指向 GitHub，但 `dsh plugin add` 对 npm 包更顺滑；发布到 npm 后别人也可以 `npm i dsh-node-monitor`：

```bash
npm login                     # 需要 npm 账号（2FA 时按提示）
npm publish --access public   # 包名 dsh-node-monitor 目前未被占用（registry 404）
```

## 如果暂时不想走 GitHub

1. 直接分发本目录的 `dsh-node-monitor-0.3.1.zip` / `.tgz`（见 `docs/INSTALL.md`），两台 PC 离线安装；
2. 或在 DSH 的「插件 → 发现 → 索引源」里加一个自定义 format-1 索引（需要把 zip/tgz 放在一个可访问的 HTTPS 地址，并写一份 `index.json`；市场对非精选来源的安装策略以你所用 DSH 版本为准，官方市场默认只接受精选来源）。
