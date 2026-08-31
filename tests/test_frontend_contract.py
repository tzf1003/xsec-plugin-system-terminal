from __future__ import annotations

import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "com.xsec.desktop" / "frontend" / "index.js"


class FrontendContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.source = FRONTEND.read_text(encoding="utf-8")

    def test_terminal_surface_contains_only_terminal_content_and_errors(self) -> None:
        surface = self.source.split("function terminalSurface(host)", 1)[1]
        self.assertIn('screen.setAttribute("aria-label", "系统终端")', self.source)
        self.assertIn("启动终端失败：", self.source)
        for text in ("打开插件设置", "重试启动终端", "点击终端区域后直接键入命令"):
            self.assertNotIn(text, surface)

    def test_settings_follow_host_theme_and_limit_windows_profiles(self) -> None:
        self.assertIn("host.onTheme?.(apply)", self.source)
        self.assertIn(':root[data-theme="light"]', self.source)
        self.assertIn('view?.platform === "windows"', self.source)
        self.assertIn('new Set(["cmd", "windows-powershell", "powershell-7"])', self.source)

    def test_manifest_versions_and_frontend_methods_match(self) -> None:
        manifest = json.loads((ROOT / "plugin.json").read_text(encoding="utf-8"))
        codex = json.loads((ROOT / ".codex-plugin" / "plugin.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["version"], codex["version"])
        methods = manifest["extensions"]["com.xsec.desktop"]["frontendApi"]["methods"]
        requested = set(re.findall(r'host\.request\("([^"]+)"', self.source))
        self.assertEqual(requested, set(methods))

    def test_source_respects_workspace_complexity_limits(self) -> None:
        lines = self.source.splitlines()
        self.assertLessEqual(len(lines), 300)
        starts = [index for index, line in enumerate(lines) if re.match(r"^(?:async )?function ", line)]
        ends = starts[1:] + [len(lines)]
        for start, end in zip(starts, ends, strict=True):
            self.assertLessEqual(end - start, 50, lines[start])


if __name__ == "__main__":
    unittest.main()
