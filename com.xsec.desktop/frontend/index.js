const WINDOWS_PROFILE_IDS = new Set(["cmd", "windows-powershell", "powershell-7"]);
const POLL_INTERVAL_MS = 100;
const RESIZE_DELAY_MS = 100;
const MIN_COLUMNS = 20;
const MIN_ROWS = 2;
const CELL_WIDTH = 8;
const CELL_HEIGHT = 16;

const e = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const errorText = (error) => error instanceof Error ? error.message : String(error);
const clean = (value) => String(value || "")
  .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
  .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");

const css = `
:root{color-scheme:dark;--bg:#111;--surface:#17191d;--surface-hover:#202329;--text:#fcfcfc;--muted:#919191;--border:#303030;--accent:#76a5ff;--danger:#ff8b88;--danger-bg:#2b171b;--danger-border:#60343c}
:root[data-theme="light"]{color-scheme:light;--bg:#fff;--surface:#f6f7f9;--surface-hover:#eceff3;--text:#17191c;--muted:#606773;--border:#d7dbe1;--accent:#3977e8;--danger:#b42318;--danger-bg:#fdeaea;--danger-border:#f4b8b2}
*{box-sizing:border-box}html,body,[data-xsec-plugin-root]{width:100%;height:100%}body{margin:0;background:var(--bg);color:var(--text)}button,select{font:inherit}[hidden]{display:none!important}
.app{display:flex;height:100%;flex-direction:column;background:var(--bg)}.screen{min-height:0;flex:1;margin:0;padding:10px 12px;overflow:auto;outline:none;color:var(--text);background:var(--bg);font:12px/1.3 ui-monospace,"SFMono-Regular",Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.screen:focus-visible{box-shadow:inset 0 0 0 1px var(--accent)}
.status{flex:0 0 auto;padding:8px 12px;border-bottom:1px solid var(--danger-border);background:var(--danger-bg);color:var(--danger);font:600 12px/1.4 ui-monospace,"SFMono-Regular",Consolas,monospace;overflow-wrap:anywhere}.status:empty{display:none}
.settings{min-height:100%;padding:24px;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}.settings-card{width:min(680px,100%);padding:20px;border:1px solid var(--border);border-radius:10px;background:var(--surface)}
.settings h1{margin:0 0 6px;font-size:20px;line-height:1.3}.settings p{margin:0;color:var(--muted)}.settings label{display:grid;gap:7px;margin:20px 0 12px;color:var(--text);font-weight:600}.settings select,.settings button{min-height:36px;padding:7px 10px;border:1px solid var(--border);border-radius:7px;background:var(--bg);color:var(--text)}
.settings select:focus-visible,.settings button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}.settings button{cursor:pointer;font-weight:600}.settings button:hover{background:var(--surface-hover)}.settings button:disabled{cursor:default;opacity:.55}.settings .effective{margin-top:10px}.settings .actions{display:flex;gap:8px;margin-top:16px}.settings .primary{border-color:var(--accent);background:var(--accent);color:#fff}.settings .notice{min-height:21px;margin-top:12px}.settings .notice.error{color:var(--danger)}
`;

function followHostTheme(host) {
  const apply = (theme) => {
    const bridged = getComputedStyle(document.documentElement)
      .getPropertyValue("--xsec-color-mode").trim();
    const mode = theme?.["color-mode"] || bridged;
    document.documentElement.dataset.theme = mode === "light" ? "light" : "dark";
  };
  apply();
  return host.onTheme?.(apply);
}

function replaceDocument(root) {
  root.replaceChildren();
  root.append(e("style", "", css));
}

function settingStatus(state, message, error = false) {
  state.controls.notice.textContent = message;
  state.controls.notice.className = `notice${error ? " error" : ""}`;
}

function renderSettingsView(state, view) {
  const profiles = Array.isArray(view?.profiles) ? view.profiles : [];
  const isWindows = view?.platform === "windows";
  state.controls.form.hidden = !isWindows;
  state.controls.systemDefault.hidden = isWindows;
  if (!isWindows) {
    state.controls.systemDefault.textContent = "当前系统的新建终端使用系统默认 Shell。";
    return;
  }
  const available = profiles.filter((item) => WINDOWS_PROFILE_IDS.has(item.id));
  if (!available.length) throw new Error("当前 Windows 系统没有可用的终端");
  state.controls.profile.replaceChildren();
  const automatic = e("option", "", "跟随系统默认终端");
  automatic.value = "";
  state.controls.profile.append(automatic);
  for (const item of available) {
    const suffix = item.is_default ? "（系统默认）" : "";
    const option = e("option", "", `${item.label || item.id}${suffix}`);
    option.value = item.id;
    state.controls.profile.append(option);
  }
  state.controls.profile.value = view?.configuredProfileId || "";
  const effective = available.find((item) => item.id === view?.effectiveProfileId);
  state.controls.effective.textContent = effective ? `新建终端将使用：${effective.label}` : "";
}

async function loadSettings(state) {
  state.ready = false;
  state.controls.save.disabled = true;
  state.controls.retry.hidden = true;
  settingStatus(state, "正在读取终端设置…");
  try {
    const view = await state.host.request("xsec.terminal.settings.get", {});
    renderSettingsView(state, view);
    state.ready = true;
    state.controls.save.disabled = false;
    settingStatus(state, "");
  } catch (error) {
    settingStatus(state, `读取终端设置失败：${errorText(error)}`, true);
    state.controls.retry.hidden = false;
  }
}

async function saveSettings(state) {
  if (!state.ready) return;
  state.controls.save.disabled = true;
  try {
    await state.host.request("xsec.terminal.settings.set", {
      profileId: state.controls.profile.value || null,
    });
    await loadSettings(state);
    if (state.ready) settingStatus(state, "默认终端已保存，仅影响之后新建的终端。");
  } catch (error) {
    settingStatus(state, `保存终端设置失败：${errorText(error)}`, true);
    state.controls.save.disabled = false;
  }
}

function buildSettings(state) {
  replaceDocument(state.root);
  const page = e("main", "settings");
  const card = e("section", "settings-card");
  const form = e("div");
  const label = e("label", "", "Windows 默认终端");
  const profile = e("select");
  const effective = e("p", "effective");
  const systemDefault = e("p");
  const actions = e("div", "actions");
  const save = e("button", "primary", "保存");
  const retry = e("button", "", "重新读取设置");
  const notice = e("p", "notice");
  form.hidden = true;
  systemDefault.hidden = true;
  save.disabled = true;
  retry.hidden = true;
  save.onclick = () => void saveSettings(state);
  retry.onclick = () => void loadSettings(state);
  label.append(profile);
  actions.append(save, retry);
  form.append(label, effective, actions);
  card.append(e("h1", "", "系统终端"), e("p", "", "设置之后新建终端使用的 Shell。"), form, systemDefault, notice);
  page.append(card);
  state.root.append(page);
  state.controls = { form, profile, effective, systemDefault, save, retry, notice };
  void loadSettings(state);
}

function terminalSettings(host) {
  const state = { host, root: undefined, controls: {}, ready: false };
  const theme = followHostTheme(host);
  return {
    mount(root) { state.root = root; buildSettings(state); },
    update() {},
    dispose() { theme?.dispose(); },
  };
}

function clearPoll(state) {
  if (state.pollTimer) clearTimeout(state.pollTimer);
  state.pollTimer = 0;
}

function report(state, message) {
  state.controls.status.textContent = message;
}

function schedulePoll(state) {
  clearPoll(state);
  if (state.disposed || !state.terminalId || document.hidden) return;
  state.pollTimer = setTimeout(() => void poll(state), POLL_INTERVAL_MS);
}

async function poll(state) {
  if (state.disposed || !state.terminalId || state.reading || document.hidden) return;
  state.reading = true;
  try {
    const data = await state.host.request("xsec.terminal.read", { terminalId: state.terminalId });
    if (data?.data) {
      state.controls.screen.textContent += clean(data.data);
      state.controls.screen.scrollTop = state.controls.screen.scrollHeight;
    }
    schedulePoll(state);
  } catch (error) {
    report(state, `读取终端失败：${errorText(error)}`);
  } finally {
    state.reading = false;
  }
}

function terminalSize(state) {
  return {
    cols: Math.max(MIN_COLUMNS, Math.floor(state.controls.screen.clientWidth / CELL_WIDTH)),
    rows: Math.max(MIN_ROWS, Math.floor(state.controls.screen.clientHeight / CELL_HEIGHT)),
  };
}

async function openTerminal(state) {
  state.controls.status.textContent = "";
  state.controls.screen.textContent = "";
  try {
    const handle = await state.host.request("xsec.terminal.open", terminalSize(state));
    state.terminalId = handle.terminal_id;
    state.controls.screen.focus();
    schedulePoll(state);
  } catch (error) {
    report(state, `启动终端失败：${errorText(error)}`);
  }
}

function scheduleWrite(state) {
  if (state.inputFrame || state.writing || !state.inputBuffer) return;
  state.inputFrame = requestAnimationFrame(() => {
    state.inputFrame = 0;
    void flushWrite(state);
  });
}

async function flushWrite(state) {
  if (state.writing || !state.inputBuffer || !state.terminalId) return;
  const data = state.inputBuffer;
  state.inputBuffer = "";
  state.writing = true;
  try {
    await state.host.request("xsec.terminal.write", { terminalId: state.terminalId, data });
  } catch (error) {
    report(state, `写入终端失败：${errorText(error)}`);
  } finally {
    state.writing = false;
    scheduleWrite(state);
  }
}

function keyInput(state, event) {
  if (event.ctrlKey && event.key.toLowerCase() === "c") {
    event.preventDefault();
    state.inputBuffer += "\x03";
    scheduleWrite(state);
    return;
  }
  const map = { Enter: "\r", Backspace: "\x7f", Tab: "\t", ArrowUp: "\x1b[A", ArrowDown: "\x1b[B", ArrowRight: "\x1b[C", ArrowLeft: "\x1b[D", Escape: "\x1b" };
  const data = map[event.key] || (event.key.length === 1 && !event.ctrlKey && !event.metaKey ? event.key : "");
  if (!data) return;
  event.preventDefault();
  state.inputBuffer += data;
  scheduleWrite(state);
}

function resizeTerminal(state) {
  if (!state.terminalId) return;
  void state.host.request("xsec.terminal.resize", {
    terminalId: state.terminalId,
    ...terminalSize(state),
  }).catch((error) => report(state, `调整终端大小失败：${errorText(error)}`));
}

function buildTerminal(state) {
  replaceDocument(state.root);
  const app = e("main", "app");
  const status = e("div", "status");
  const screen = e("pre", "screen", "");
  screen.tabIndex = 0;
  screen.setAttribute("role", "application");
  screen.setAttribute("aria-label", "系统终端");
  screen.onkeydown = (event) => keyInput(state, event);
  app.append(status, screen);
  state.root.append(app);
  state.controls = { status, screen };
  state.observer = new ResizeObserver(() => {
    clearTimeout(state.resizeTimer);
    state.resizeTimer = setTimeout(() => resizeTerminal(state), RESIZE_DELAY_MS);
  });
  state.observer.observe(screen);
  state.visibility = () => document.hidden ? clearPoll(state) : schedulePoll(state);
  document.addEventListener("visibilitychange", state.visibility);
  void openTerminal(state);
}

async function disposeTerminal(state) {
  state.disposed = true;
  clearPoll(state);
  clearTimeout(state.resizeTimer);
  cancelAnimationFrame(state.inputFrame);
  state.observer?.disconnect();
  state.theme?.dispose();
  document.removeEventListener("visibilitychange", state.visibility);
  if (state.terminalId) await state.host.request("xsec.terminal.close", { terminalId: state.terminalId });
  state.terminalId = "";
}

function terminalSurface(host) {
  const state = {
    host, root: undefined, controls: {}, terminalId: "", disposed: false,
    reading: false, writing: false, inputBuffer: "", pollTimer: 0,
    resizeTimer: 0, inputFrame: 0, observer: undefined, visibility: undefined,
    theme: followHostTheme(host),
  };
  return {
    mount(root) { state.root = root; state.disposed = false; buildTerminal(state); },
    update() {},
    dispose() { return disposeTerminal(state); },
  };
}

export function activate(host) {
  return host.context?.kind === "settings-page" ? terminalSettings(host) : terminalSurface(host);
}
