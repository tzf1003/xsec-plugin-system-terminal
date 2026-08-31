from __future__ import annotations

import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLUGIN_ROOT = ROOT / "plugins" / "com.xsec.system-terminal"
FRONTEND = PLUGIN_ROOT / "com.xsec.desktop" / "frontend" / "index.js"


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
        self.assertIn("effective.label || effective.id", self.source)

    def test_windows_profile_is_loaded_for_each_new_terminal(self) -> None:
        options = self.source.split("async function terminalOpenOptions", 1)[1]
        options = options.split("async function openTerminal", 1)[0]
        self.assertIn('/Windows/i.test(navigator.userAgent)', options)
        self.assertIn('host.request("xsec.terminal.settings.get"', options)
        self.assertIn("profileId: settings?.effectiveProfileId", options)
        self.assertNotIn(".catch", options)
        self.assertGreater(
            options.rfind("terminalSize(state)"),
            options.index('host.request("xsec.terminal.settings.get"'),
        )
        opened = self.source.split("state.terminalId = handle.terminal_id", 1)[1]
        opened = opened.split("function scheduleWrite", 1)[0]
        self.assertIn("resizeTerminal(state)", opened)

    def test_polling_stops_on_read_failure_and_throttles_idle_reads(self) -> None:
        poll = self.source.split("async function poll", 1)[1]
        poll = poll.split("function terminalSize", 1)[0]
        self.assertIn("IDLE_POLL_INTERVAL_MS = 500", self.source)
        self.assertIn("failTerminal(state, `读取终端失败：", poll)
        self.assertNotIn("schedulePoll(state", poll.split("catch (error)", 1)[1].split("finally", 1)[0])

    def test_remount_owns_theme_and_async_terminal_results(self) -> None:
        self.assertGreaterEqual(self.source.count("state.theme = followHostTheme(host)"), 2)
        self.assertIn("generation !== state.generation", self.source)
        self.assertIn("isCurrentTerminal(state, generation, terminalId)", self.source)
        self.assertIn('state.terminalId = ""', self.source)

    def test_manifest_versions_and_frontend_methods_match(self) -> None:
        manifest = json.loads((PLUGIN_ROOT / "plugin.json").read_text(encoding="utf-8"))
        codex = json.loads((PLUGIN_ROOT / ".codex-plugin" / "plugin.json").read_text(encoding="utf-8"))
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
