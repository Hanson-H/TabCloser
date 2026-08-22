// 浮动按钮关闭标签页 - 设置页脚本

const enabledEl = document.getElementById("enabled");
const statusEl = document.getElementById("status");
const statusTextEl = document.getElementById("statusText");
const previewTip = document.getElementById("previewTip");
const demoBtn = document.getElementById("demoBtn");

// 版本号跟随 manifest 自动更新，无需手动维护
const verEl = document.querySelector(".header .ver");
if (verEl) verEl.textContent = "v" + chrome.runtime.getManifest().version;

let settings = { enabled: true };

// 根据 settings 同步 UI 状态
function render() {
  enabledEl.checked = settings.enabled;

  // 头部状态文案
  if (settings.enabled) {
    statusEl.classList.remove("off");
    statusTextEl.textContent = "运行中 · 悬停弹出，点击关闭标签页";
  } else {
    statusEl.classList.add("off");
    statusTextEl.textContent = "已停用 · 网页中不显示浮动按钮";
  }

  // 预览区提示文案
  previewTip.textContent = settings.enabled
    ? "这就是网页中显示的按钮 · 可拖动，拖到屏幕边缘可贴边隐藏"
    : "已停用 · 当前网页中不会显示浮动按钮";

  demoBtn.style.display = settings.enabled ? "flex" : "none";
}

// 载入当前设置
chrome.storage.sync.get({ enabled: true }, (items) => {
  settings = items;
  render();
});

// 保存设置
enabledEl.addEventListener("change", () => {
  settings.enabled = enabledEl.checked;
  chrome.storage.sync.set({ enabled: settings.enabled });
  render();
});

// 监听其他页面修改设置
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (changes.enabled) {
    settings.enabled = changes.enabled.newValue;
    render();
  }
});

// 预览按钮：点击仅给出反馈（设置页不会被关闭）
demoBtn.addEventListener("click", () => {
  const original = previewTip.textContent;
  previewTip.textContent = "✅ 在普通网页中，点击此按钮会关闭当前标签页";
  previewTip.style.color = "var(--success)";
  setTimeout(() => {
    previewTip.textContent = original;
    previewTip.style.color = "";
  }, 1500);
});

// 重置按钮位置：清空保存的位置，所有网页的按钮回到顶部中央贴边隐藏
const resetBtn = document.getElementById("resetPos");
resetBtn.addEventListener("click", () => {
  chrome.storage.local.set({ pos: null }, () => {
    const original = previewTip.textContent;
    previewTip.textContent = "✅ 已重置 · 所有网页的按钮回到页面顶部中央";
    previewTip.style.color = "var(--success)";
    setTimeout(() => {
      previewTip.textContent = original;
      previewTip.style.color = "";
    }, 1500);
  });
});
