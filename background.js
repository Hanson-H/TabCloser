// 双击关闭标签页 - 后台 Service Worker

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "closeTab" && sender.tab && sender.tab.id) {
    chrome.tabs.remove(sender.tab.id, () => {
      // 标签页可能已被用户手动关闭，忽略错误
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ ok: true });
      }
    });
    return true; // 异步 sendResponse
  }
});
