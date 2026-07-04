console.log("Media Downloader: Background service worker active.");

chrome.runtime.onInstalled.addListener(() => {
  console.log("Media Downloader Extension Installed.");
});
