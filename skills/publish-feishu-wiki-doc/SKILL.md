---
name: publish-feishu-wiki-doc
description: Publish or replace a Markdown document in Feishu/Lark Wiki using lark-cli, with deterministic SVG-only asset upload, parent-node placement, inherited permissions, placeholder cleanup, and final content verification. Use whenever the user asks to upload, publish, synchronize, replace, or create a Feishu/Lark Wiki cloud document from a local Markdown/wiki page.
---

# Publish Feishu Wiki Doc

Use the bundled script as the default execution path. It avoids loading full documents into model context and performs the repetitive media workflow deterministically. This skill is portable: it does not assume any specific Feishu/Lark tenant, account, profile, or local path.

## Requirements And Defaults

- Required CLI: `lark-cli` or `lark-cli.cmd` on `PATH`.
- Profile: pass `--profile <name>` when the user specifies one. Otherwise the script uses `LARK_CLI_PROFILE`, then `default`.
- Identity: `user`.
- API: docs v2.
- Images: local `.svg` only, uploaded as Feishu file cards. Reject PNG, JPG, GIF, WebP, remote image URLs, and missing SVG files.
- Permissions for new Wiki pages: inherit from the specified parent Wiki node. Never call permission-member APIs unless the user explicitly requests a permission override.
- Existing target: preserve its current location and permissions.
- Optional identity guard: pass `--expected-user-open-id <open_id>` only when the user requires publishing as a specific authenticated user.

## Publish

Replace an existing Wiki document:

```powershell
python <skill-dir>/scripts/publish_feishu_wiki_doc.py `
  --source C:\path\page.md `
  --target-wiki-url https://tenant.feishu.cn/wiki/TOKEN
```

Create a child page under a parent Wiki page:

```powershell
python <skill-dir>/scripts/publish_feishu_wiki_doc.py `
  --source C:\path\page.md `
  --parent-wiki-url https://tenant.feishu.cn/wiki/PARENT_TOKEN
```

The first Markdown `#` heading becomes the title. Use `--title` only when the source has no H1 or the user explicitly requests another title.

## Preflight

Run preparation without Feishu writes:

```powershell
python <skill-dir>/scripts/publish_feishu_wiki_doc.py `
  --source C:\path\page.md `
  --prepare-only
```

This validates UTF-8, strips YAML frontmatter, resolves SVG paths relative to the Markdown file, and prints a compact JSON manifest.

## Required behavior

1. Resolve `<skill-dir>` as the directory containing this `SKILL.md`, then run the bundled script by absolute path.
2. Treat any SVG validation failure as blocking. Do not silently omit or rasterize images.
3. For new pages, require `--parent-wiki-url`; do not fall back to `my_library` because that breaks the parent-permission contract.
4. Do not add collaborators, transfer ownership, or grant `full_access` automatically.
5. Report the script's final JSON fields: document URL, revision, title, SVG count, placeholder count, and permission mode.
6. If authorization is missing, ask the user to authorize the selected lark-cli profile and resume after they confirm.

## Script output

Success returns one compact JSON object. The important invariants are:

- `svg_expected == svg_uploaded`
- `placeholder_count == 0`
- `raster_image_count == 0`
- `replacement_char_count == 0`
- New pages report `permission_mode: inherited_from_parent_no_acl_calls`
