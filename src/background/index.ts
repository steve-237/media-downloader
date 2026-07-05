console.log("Media Downloader: Background service worker active.");

chrome.runtime.onInstalled.addListener(() => {
  console.log("Media Downloader Extension Installed.");
});

chrome.runtime.onMessage.addListener((request: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  if (request.action === "DOWNLOAD") {
    const { urls } = request;
    if (urls && Array.isArray(urls)) {
      let pending = urls.length;
      let errors: string[] = [];
      urls.forEach((url: string) => {
        console.log("Media Downloader Pro: Starting download for", url);
        chrome.downloads.download({
          url: url,
          conflictAction: "uniquify"
        }, (downloadId) => {
          pending--;
          if (chrome.runtime.lastError) {
            errors.push(chrome.runtime.lastError.message || "Unknown error");
            console.error("Media Downloader Pro: Download failed for", url, chrome.runtime.lastError.message);
          } else {
            console.log("Media Downloader Pro: Download started with ID:", downloadId);
          }
          if (pending === 0) {
            if (errors.length > 0) {
              sendResponse({ error: errors.join(", ") });
            } else {
              sendResponse({ status: "started" });
            }
          }
        });
      });
      // Do not call sendResponse here, let the callback handle it
      return true; // Keep message channel open for async response
    }
  }
  return true;
});
