console.log("Media Downloader: Background service worker active.");

chrome.runtime.onInstalled.addListener(() => {
  console.log("Media Downloader Extension Installed.");
});

chrome.runtime.onMessage.addListener((request: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  if (request.action === "DOWNLOAD") {
    const { urls } = request;
    if (urls && Array.isArray(urls)) {
      urls.forEach((url: string) => {
        chrome.downloads.download({
          url: url,
          conflictAction: "uniquify"
        });
      });
      sendResponse({ status: "started" });
    }
  }
  return true;
});
