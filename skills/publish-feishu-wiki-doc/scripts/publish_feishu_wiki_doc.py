#!/usr/bin/env python3
"""Publish Markdown to Feishu Wiki using PNG image blocks.

Image policy (supersedes the earlier SVG-file-card behaviour of this script):
every local image is uploaded as a PNG *image block* via
`docs +media-insert --type image`, so it renders inline instead of becoming a
click-to-download attachment.

    .png                        used as-is
    .svg                        same-named .png if present, else rendered
    .jpg/.jpeg/.gif/.webp/.bmp  converted with Pillow
    remote URL / missing file   hard error, never silently dropped

Conversions are written to a scratch directory; the source Markdown and its
images are never modified.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


DEFAULT_PROFILE = os.environ.get("LARK_CLI_PROFILE", "default")
FRONTMATTER_RE = re.compile(r"\A---\r?\n.*?\r?\n---\r?\n", re.DOTALL)
MARKDOWN_IMAGE_RE = re.compile(
    r"!\[(?P<alt>[^\]]*)\]\((?P<path><[^>]+>|[^\s)]+)"
    r"(?:\s+[\"'][^\"']*[\"'])?\)"
)
OBSIDIAN_IMAGE_RE = re.compile(r"!\[\[(?P<path>[^\]|]+)(?:\|[^\]]+)?\]\]")
H1_RE = re.compile(r"(?m)^#\s+(.+?)\s*$")


class PublishError(RuntimeError):
    pass


@dataclass(frozen=True)
class ImageAsset:
    marker: str
    path: Path
    alt: str


def compact_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def extract_json(text: str) -> Any:
    decoder = json.JSONDecoder()
    for index, char in enumerate(text):
        if char not in "[{":
            continue
        try:
            value, _ = decoder.raw_decode(text[index:])
            return value
        except json.JSONDecodeError:
            continue
    raise PublishError(f"command returned no JSON: {text[-500:]}")


def find_lark_cli() -> str:
    for name in ("lark-cli.cmd", "lark-cli"):
        found = shutil.which(name)
        if found:
            return found
    raise PublishError("lark-cli is not installed or not on PATH")


def run_json(command: list[str], cwd: Path | None = None) -> Any:
    completed = subprocess.run(
        command,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    combined = "\n".join(part for part in (completed.stdout, completed.stderr) if part)
    if completed.returncode != 0:
        try:
            payload = extract_json(combined)
            message = payload.get("error", {}).get("message", combined[-500:])
        except (PublishError, AttributeError):
            message = combined[-500:]
        raise PublishError(message)
    return extract_json(combined)


def wiki_token(value: str) -> str:
    parsed = urlparse(value)
    match = re.search(r"/wiki/([^/?#]+)", parsed.path)
    if not match:
        raise PublishError(f"not a Feishu Wiki URL: {value}")
    return match.group(1)


RASTER_SUFFIXES = {".jpg", ".jpeg", ".gif", ".webp", ".bmp"}


def _render_svg_to_png(svg: Path, workdir: Path) -> Path | None:
    """Best-effort SVG rasterisation. Returns None when no renderer is usable."""
    out = workdir / (svg.stem + ".png")
    attempts = (
        ("rsvg-convert", ["-o", str(out), str(svg)]),
        ("inkscape", [str(svg), "--export-type=png", "--export-filename", str(out)]),
        ("convert", [str(svg), str(out)]),
    )
    for name, rest in attempts:
        exe = shutil.which(name)
        if not exe:
            continue
        subprocess.run([exe, *rest], capture_output=True, check=False)
        if out.is_file() and out.stat().st_size:
            return out
    try:
        import cairosvg  # type: ignore
    except ImportError:
        return None
    cairosvg.svg2png(url=str(svg), write_to=str(out))
    return out if out.is_file() and out.stat().st_size else None


def _convert_raster_to_png(src: Path, workdir: Path) -> Path | None:
    """Convert a non-PNG raster to PNG with Pillow. None when Pillow is absent."""
    try:
        from PIL import Image  # type: ignore
    except ImportError:
        return None
    out = workdir / (src.stem + ".png")
    with Image.open(src) as image:
        mode = "RGBA" if image.mode in ("RGBA", "LA", "P") else "RGB"
        image.convert(mode).save(out, "PNG")
    return out if out.is_file() and out.stat().st_size else None


def resolve_image(source_dir: Path, raw_path: str, workdir: Path) -> Path:
    """Resolve one Markdown image reference to a local PNG on disk.

    Blocking on an unresolvable image is deliberate: a silently dropped figure
    produces a page that looks complete and is not.
    """
    path_text = raw_path[1:-1] if raw_path.startswith("<") and raw_path.endswith(">") else raw_path
    parsed = urlparse(path_text)
    if parsed.scheme or parsed.netloc:
        raise PublishError(f"remote images are not allowed; provide a local file: {path_text}")
    path = (source_dir / path_text).resolve()
    if not path.is_file():
        raise PublishError(f"image does not exist: {path}")
    suffix = path.suffix.lower()

    if suffix == ".png":
        return path

    if suffix == ".svg":
        sibling = path.with_suffix(".png")
        if sibling.is_file():
            return sibling
        rendered = _render_svg_to_png(path, workdir)
        if rendered:
            return rendered
        raise PublishError(
            f"cannot use {path}: no same-named PNG and no SVG renderer available. "
            "Export a PNG next to it, or install rsvg-convert / inkscape / cairosvg. "
            "SVG file cards are not an acceptable fallback."
        )

    if suffix in RASTER_SUFFIXES:
        converted = _convert_raster_to_png(path, workdir)
        if converted:
            return converted
        raise PublishError(
            f"cannot convert {path} to PNG: Pillow is not installed (pip install Pillow)"
        )

    raise PublishError(f"unsupported image type {suffix or '(none)'}: {path_text}")


def prepare_markdown(
    source: Path, explicit_title: str | None, workdir: Path
) -> tuple[str, str, list[ImageAsset]]:
    try:
        text = source.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise PublishError(f"source must be valid UTF-8: {source}") from exc
    if "\ufffd" in text:
        raise PublishError("source contains Unicode replacement characters")

    text = FRONTMATTER_RE.sub("", text)
    assets: list[ImageAsset] = []
    def replace(raw_path: str, alt: str) -> str:
        path = resolve_image(source.parent, raw_path, workdir)
        digest_input = f"{path}:{len(assets) + 1}"
        digest = hashlib.sha256(digest_input.encode("utf-8")).hexdigest()[:10]
        marker = f"【FEISHU_IMG_{len(assets) + 1:03d}_{digest}】"
        asset = ImageAsset(marker=marker, path=path, alt=alt.strip() or path.stem)
        assets.append(asset)
        return asset.marker

    text = MARKDOWN_IMAGE_RE.sub(
        lambda match: replace(match.group("path"), match.group("alt")),
        text,
    )
    text = OBSIDIAN_IMAGE_RE.sub(
        lambda match: replace(match.group("path"), Path(match.group("path")).stem),
        text,
    )

    suspicious = re.findall(r"!\[[^\]]*\]\([^)]+\)|!\[\[[^\]]+\]\]", text)
    if suspicious:
        raise PublishError(f"unprocessed image syntax remains: {suspicious[0]}")
    if re.search(r"<img\b", text, re.IGNORECASE):
        raise PublishError("HTML <img> is not allowed; use a local Markdown image")

    title_match = H1_RE.search(text)
    title = explicit_title or (title_match.group(1).strip() if title_match else "")
    if not title:
        raise PublishError("document title is required: add an H1 or pass --title")
    return text, title, assets


def base_command(cli: str, profile: str) -> list[str]:
    return [cli, "--profile", profile]


def check_auth(cli: str, profile: str, expected_user_open_id: str | None) -> None:
    payload = run_json(base_command(cli, profile) + ["auth", "status", "--verify"])
    user = payload.get("identities", {}).get("user", {})
    if not user.get("available"):
        raise PublishError(f"profile {profile} is not authorized; run auth login for this profile")
    if expected_user_open_id and user.get("openId") != expected_user_open_id:
        raise PublishError(f"profile {profile} is not authorized as expected user {expected_user_open_id}")


def resolve_existing_document(cli: str, profile: str, target_url: str) -> str:
    payload = run_json(
        base_command(cli, profile)
        + [
            "docs",
            "+fetch",
            "--api-version",
            "v2",
            "--as",
            "user",
            "--doc",
            target_url,
            "--scope",
            "outline",
            "--max-depth",
            "1",
            "--format",
            "json",
        ]
    )
    return payload["data"]["document"]["document_id"]


def create_child_document(
    cli: str, profile: str, parent_url: str, title: str
) -> tuple[str, str]:
    parent_token = wiki_token(parent_url)
    payload = run_json(
        base_command(cli, profile)
        + [
            "wiki",
            "+node-create",
            "--as",
            "user",
            "--parent-node-token",
            parent_token,
            "--obj-type",
            "docx",
            "--title",
            title,
        ]
    )
    data = payload.get("data", payload)
    document_id = data.get("obj_token") or data.get("document_id")
    node_token = data.get("node_token")
    if not document_id or not node_token:
        raise PublishError(f"node creation response lacks tokens: {compact_json(payload)}")
    return document_id, node_token


def overwrite_document(
    cli: str, profile: str, document_id: str, markdown: str, title: str
) -> None:
    # docs +update v2 removed --new-title (passing it is a hard error). A new page
    # gets its title from `wiki +node-create`; an existing page keeps its own.
    # `title` stays in the signature because verify_document still asserts it.
    del title
    with tempfile.TemporaryDirectory(prefix="feishu-publish-") as temp:
        temp_dir = Path(temp)
        prepared = temp_dir / "prepared.md"
        prepared.write_text(markdown, encoding="utf-8", newline="\n")
        run_json(
            base_command(cli, profile)
            + [
                "docs",
                "+update",
                "--api-version",
                "v2",
                "--as",
                "user",
                "--doc",
                document_id,
                "--command",
                "overwrite",
                "--doc-format",
                "markdown",
                "--content",
                "@prepared.md",
            ],
            cwd=temp_dir,
        )


def upload_png_assets(
    cli: str, profile: str, document_id: str, assets: list[ImageAsset]
) -> None:
    for asset in assets:
        run_json(
            base_command(cli, profile)
            + [
                "docs",
                "+media-insert",
                "--as",
                "user",
                "--doc",
                document_id,
                "--file",
                # cwd is the asset's directory (see run_json below); an absolute
                # @path is poorly supported. os.path.join keeps this correct on
                # both POSIX ("./x.png") and Windows (".\\x.png").
                os.path.join(os.curdir, asset.path.name),
                "--type",
                "image",
                "--selection-with-ellipsis",
                asset.marker,
            ],
            cwd=asset.path.parent,
        )
        run_json(
            base_command(cli, profile)
            + [
                "docs",
                "+update",
                "--api-version",
                "v2",
                "--as",
                "user",
                "--doc",
                document_id,
                "--command",
                "str_replace",
                "--pattern",
                asset.marker,
                "--content",
                "",
            ]
        )


def verify_document(
    cli: str,
    profile: str,
    document_id: str,
    expected_title: str,
    expected_png_count: int,
) -> dict[str, Any]:
    payload = run_json(
        base_command(cli, profile)
        + [
            "docs",
            "+fetch",
            "--api-version",
            "v2",
            "--as",
            "user",
            "--doc",
            document_id,
            "--detail",
            "full",
            "--format",
            "json",
        ]
    )
    document = payload["data"]["document"]
    content = document["content"]
    title_match = re.search(r"<title[^>]*>(.*?)</title>", content, re.DOTALL)
    actual_title = re.sub(r"<[^>]+>", "", title_match.group(1)).strip() if title_match else ""
    # The fetched representation of an image block is not contractual, so count
    # every plausible marker and report them all. Reporting keeps a wrong
    # assumption visible instead of letting it pass as a green check.
    patterns = {
        "img_tag": len(re.findall(r"<img\b", content)),
        "image_tag": len(re.findall(r"<image\b", content)),
        "image_token": len(re.findall(r"image_token", content)),
        "mime_png": len(re.findall(r'mime="image/png"', content)),
    }
    result = {
        "document_id": document_id,
        "revision": document["revision_id"],
        "title": actual_title,
        "png_expected": expected_png_count,
        "png_inserted": max(patterns.values()),
        "png_pattern_counts": patterns,
        "svg_sources": len(re.findall(r'mime="image/svg\+xml"', content)),
        "placeholder_count": content.count("FEISHU_IMG_"),
        "replacement_char_count": content.count("\ufffd"),
        "content_chars": len(content),
    }
    if actual_title != expected_title:
        raise PublishError(f"title verification failed: {compact_json(result)}")
    if result["png_inserted"] != expected_png_count:
        raise PublishError(f"PNG verification failed: {compact_json(result)}")
    if any(
        result[key]
        for key in ("svg_sources", "placeholder_count", "replacement_char_count")
    ):
        raise PublishError(f"content verification failed: {compact_json(result)}")
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    target = parser.add_mutually_exclusive_group()
    target.add_argument("--target-wiki-url")
    target.add_argument("--parent-wiki-url")
    parser.add_argument("--title")
    parser.add_argument("--profile", default=DEFAULT_PROFILE)
    parser.add_argument("--expected-user-open-id")
    parser.add_argument("--prepare-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source = args.source.resolve()
    if not source.is_file():
        raise PublishError(f"source Markdown does not exist: {source}")

    # Converted images live here for the lifetime of the run; the source tree is
    # never written to (format conversion belongs to the publish layer only).
    with tempfile.TemporaryDirectory(prefix="feishu-images-") as scratch:
        workdir = Path(scratch)
        markdown, title, assets = prepare_markdown(source, args.title, workdir)

        if args.prepare_only:
            print(
                compact_json(
                    {
                        "ok": True,
                        "title": title,
                        "png_count": len(assets),
                        "png_files": [str(asset.path) for asset in assets],
                        "prepared_characters": len(markdown),
                    }
                )
            )
            return 0
        if not args.target_wiki_url and not args.parent_wiki_url:
            raise PublishError(
                "pass --target-wiki-url to replace a page or --parent-wiki-url to create a child page"
            )

        cli = find_lark_cli()
        check_auth(cli, args.profile, args.expected_user_open_id)
        node_token = None
        permission_mode = "existing_document_permissions_unchanged"
        if args.target_wiki_url:
            document_id = resolve_existing_document(cli, args.profile, args.target_wiki_url)
            document_url = args.target_wiki_url
        else:
            document_id, node_token = create_child_document(
                cli, args.profile, args.parent_wiki_url, title
            )
            parent = urlparse(args.parent_wiki_url)
            document_url = f"{parent.scheme}://{parent.netloc}/wiki/{node_token}"
            permission_mode = "inherited_from_parent_no_acl_calls"

        try:
            overwrite_document(cli, args.profile, document_id, markdown, title)
            upload_png_assets(cli, args.profile, document_id, assets)
            result = verify_document(cli, args.profile, document_id, title, len(assets))
        except PublishError as exc:
            if node_token:
                # The node already exists but is empty or half-filled. Re-running
                # with --parent-wiki-url would create a duplicate page, so point
                # the caller at the node it should resume into instead.
                raise PublishError(
                    f"{exc} | the child node was already created: retry with "
                    f"--target-wiki-url {document_url} instead of --parent-wiki-url"
                ) from exc
            raise
        result.update(
            {
                "ok": True,
                "document_url": document_url,
                "node_token": node_token,
                "permission_mode": permission_mode,
                "profile": args.profile,
            }
        )
        print(compact_json(result))
        return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except PublishError as exc:
        print(compact_json({"ok": False, "error": str(exc)}), file=sys.stderr)
        raise SystemExit(1)
