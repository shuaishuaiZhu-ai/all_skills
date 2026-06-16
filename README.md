# agent-skills

跨机器、跨 **Claude Code** 与 **OpenAI Codex CLI** 的共享 skill 仓库。

一个仓库 = 单一真相源;一个零依赖的 `sync.py` 把它「编译」成两个工具各自认得的形式:

- **Claude Code**:把自有 skill 复制进 `~/.claude/skills/`(原生自动发现),并按 `manifest.json`
  用 `claude plugin install` 装好插件形态的技能集(如 superpowers)。
- **Codex CLI**(无插件系统、无自动发现):在 `~/.codex/AGENTS.md` 生成一段「技能索引 + 何时用 +
  文件绝对路径」的路由块,Codex 常驻读到、需要时自己 `Read` 对应文件;插件形态的 skill 路由直接
  指向插件落地路径(不复制),与 Claude 共用同一份正本。

## 新机器:拉取即用

```bash
git clone <repo-url> ~/agent-skills
cd ~/agent-skills
python sync.py            # Windows: py -3 sync.py
```

`sync.py`(默认 `install`)只依赖 Python 3 标准库。没装 Claude / Codex 的那一侧会自动跳过并提示。

## 安装清单 = manifest.json

`install` 只装 `manifest.json` 里声明的东西,不多不少:

```jsonc
{
  "plugins": [ /* 插件形态的技能集:声明依赖,由 claude plugin install 安装,不复制 */ ],
  "skills":  [ /* 仓库自有 skill:复制进 ~/.claude/skills/ */ ],
  "codex":   { "include_plugin_skills": true, "plugin_skills": ["superpowers/*"] }
}
```

## 子命令

| 命令 | 作用 |
|---|---|
| `python sync.py`（= `install`） | 装插件依赖 + 复制自有 skill + 生成 Codex 路由 |
| `python sync.py install --dry-run` | 只打印将做什么,不改动 |
| `python sync.py collect [--json]` | 列出本机「非插件、可贡献」的候选 skill |
| `python sync.py push --only a,b` | 把选中的本机 skill 收进仓库并 `git commit && push` |
| `python sync.py add <目录>` | 收录任意含 `SKILL.md` 的目录(如 Codex 的 prompt) |
| `python sync.py doctor` | 只报告:重复 / 残留 / 失效路径 / 待贡献候选 |
| `python sync.py uninstall` | 移除本工具装过的 skill + 清掉 Codex 路由区间 |

## 贡献回仓库（在 Claude/Codex 里说「push skills」）

仓库内的 `contribute-skills` 技能会让代理自动:`collect --json` → **弹多选框**让你勾选 →
`push --only <勾选项>`。`sync.py` 不含交互 UI,复选框由 Claude/Codex 自带多选 UI 呈现。

## 去重与撞名(为什么不把 superpowers 复制进来)

原则:**插件归插件,仓库归仓库——靠「声明依赖」去重,不靠「复制副本」。**

- 有插件形态的技能集(superpowers、cloudflare 系…)**只在 `manifest.plugins` 声明**,由
  `claude plugin install` 安装(幂等:云端有/本地已装 → 只确保到位,不产生第二份),云端市场是正本。
- 仓库 `skills/` 只放**没有插件形态、你手写**的 skill。
- 撞名时**仓库优先**:`install` 复制时若遇 `~/.claude/skills/` 下非本工具管理的同名个人副本,
  备份为 `<名>.bak` 后覆盖;插件命名空间副本(`plugin:skill`)与个人裸名不在同一路径,仅告警提示。
- `doctor` 会列出历史遗留的「个人 skill 与插件同名重复」,供你清理。

## 清理历史重复(doctor → 手动删除)

Claude 安装某些插件(如 `cloudflare`)时,会把插件的 skill **自动抽取一份**到 `~/.claude/skills/`,
于是同一技能既在插件里、又留了个人裸名副本——重复且容易混淆。`sync.py` **只报告、不自动删**
(删个人文件由你决定)。安全清理步骤:

1. **列出重复**:
   ```bash
   python sync.py doctor        # 看「① 个人 skill 与已装插件同名重复」
   ```
2. **删前核对**:确认个人副本没被你改过(与插件版逐字节比对);若完全一致或只是格式差异,即可删。
3. **备份后删除**(可回滚):
   ```bash
   cd ~/.claude/skills
   tar -czf ~/skills-dup-backup.tar.gz <重复名...>
   rm -rf <重复名...>
   ```
4. **复查**:`python sync.py doctor` 的 ① 应为 0。

删掉的只是 `~/.claude/skills/` 下的个人副本;插件本身不受影响,技能继续以带命名空间的
`plugin:skill` 形式提供(如 `cloudflare:wrangler`)。本工具管理的 7 个 skill(账本
`~/.claude/skills/.agent-skills-installed.json` 记录)不会被列为重复,也不受影响。
