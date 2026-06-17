---
name: contribute-skills
description: Use when the user wants to push, contribute, share, or publish skills from this machine into the shared agent-skills repo (e.g. "push skills", "贡献 skills", "把这个 skill 同步上去"). Drives the collect → checkbox-select → push flow.
---

# Contribute Skills（把本机 skill 贡献回共享仓库）

这个仓库(`agent-skills`,默认在 `~/agent-skills`)是跨机器、跨 Claude/Codex 的 skill 单一真相源。
本技能指导你把本机 `~/.claude/skills/` 里**新写或改过**的 skill 收进仓库并推送,让其他机器拉取后也能用。

## 何时触发

用户说「push skills」「贡献 / 同步 skills」「把这个 skill 推上去」等。

## 最简路径:让用户直接跑 push.py

若用户能在终端操作,**首选**让其运行仓库里的交互脚本——自带分类(新增/更新)+ 复选框 TUI:

```bash
python ~/agent-skills/push.py        # Windows: py -3 push.py
```

它会自动收集、弹复选框、提交并 push,无需代理介入。**只有当用户希望由你(代理)代为挑选**,
或终端不便交互时,才走下面的「代理多选框」步骤。

## 步骤(代理代选)

1. **定位仓库与脚本**:找到 `agent-skills` 仓库根目录的 `sync.py`(默认 `~/agent-skills/sync.py`;
   若不在,问用户克隆路径)。下面用 `SYNC=<该路径>` 表示。

2. **收集候选**(只读,不改动):
   ```bash
   python "$SYNC" collect --json
   ```
   输出是一个 JSON 数组,每项含 `name` / `description` / `status`(`new`=仓库没有 / `modified`=本机改过 /
   `unchanged`=与仓库一致)/ `path`。`unchanged` 的通常无需再推。

3. **弹复选框让用户选**:用你平台的**多选 UI** 把候选列出来给用户勾选——
   - Claude Code:用 AskUserQuestion,`multiSelect: true`,每个候选一项,label=`name`,
     description 里带上 `status` 与 skill 的 description。
   - Codex:用等价的多选交互(`update_plan` / 逐项确认)呈现同样的清单。
   默认建议勾选 `new` 与 `modified`,不勾 `unchanged`。

4. **执行推送**(把勾选项传给 `--only`,逗号分隔):
   ```bash
   python "$SYNC" push --only <名1,名2,...>
   ```
   `push` 会:复制进仓库 `skills/` → 登记 `manifest.json` → `git add -A && commit && push`。
   - 若某名字其实由**插件**提供,会被守卫拒绝并提示「应加到 `manifest.plugins` 声明依赖」;
     仅当用户明确要用魔改版覆盖官方插件时,才加 `--force-vendor`。

5. **告知结果**:推送成功后提醒用户——其他机器执行 `git pull && python sync.py` 即可获得这些 skill。

## 注意

- 不要把**插件提供**的 skill(如 superpowers、cloudflare 系)vendor 进仓库;它们应在 `manifest.plugins`
  里声明依赖,由 `claude plugin install` 安装,保持云端为正本、自动更新。
- `~/.claude/skills/` 之外的来源(如 Codex 写的 prompt 目录):用 `python "$SYNC" add <目录路径>`。
