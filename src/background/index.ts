console.log("Media Downloader Pro: Background service worker active.");

chrome.runtime.onInstalled.addListener(() => {
  console.log("Media Downloader Extension Installed.");
});

// Handle download requests from popup and content script
chrome.runtime.onMessage.addListener(
  (request: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
    if (request.action === "DOWNLOAD") {
      const urls: string[] = request.urls;
      if (!urls || !Array.isArray(urls) || urls.length === 0) {
        sendResponse({ error: "No URLs provided" });
        return true;
      }

      let completed = 0;
      let failed = 0;
      const total = urls.length;

      urls.forEach((url: string) => {
        // Extract a filename from the URL
        let filename: string | undefined;
        try {
          const pathname = new URL(url).pathname;
          const segments = pathname.split('/');
          const lastSegment = segments[segments.length - 1];
          if (lastSegment && lastSegment.includes('.')) {
            filename = decodeURIComponent(lastSegment.split('?')[0]);
          }
        } catch (_e) { /* ignore */ }

        console.log("MDP: Downloading", url, filename ? `as ${filename}` : "");

        chrome.downloads.download(
          {
            url: url,
            filename: filename,
            conflictAction: "uniquify",
          },
          (downloadId) => {
            completed++;
            if (chrome.runtime.lastError) {
              failed++;
              console.error("MDP: Download failed:", url, chrome.runtime.lastError.message);
            } else {
              console.log("MDP: Download started, ID:", downloadId);
            }
            // Respond when all downloads have been initiated
            if (completed === total) {
              sendResponse({
                status: failed === 0 ? "ok" : "partial",
                started: total - failed,
                failed: failed,
              });
            }
          }
        );
      });

      return true; // Keep message channel open for async sendResponse
    }

    // Handle download via tab (fallback: open the URL in a new tab to trigger browser download)
    if (request.action === "DOWNLOAD_VIA_TAB") {
      const url: string = request.url;
      if (url) {
        chrome.tabs.create({ url: url, active: false }, (tab) => {
          // Close the tab after a short delay
          if (tab.id) {
            setTimeout(() => {
              chrome.tabs.remove(tab.id!).catch(() => {});
            }, 3000);
          }
        });
        sendResponse({ status: "ok" });
      }
      return true;
    }

    return false;
  }
);
