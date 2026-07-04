console.log("Media Downloader: Content script injected!");

chrome.runtime.onMessage.addListener((request: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  if (request.action === "SCAN_IMAGES") {
    // Select all <img> tags
    const imgElements = Array.from(document.querySelectorAll('img'));
    
    // Extract sources
    const images = imgElements
      .map(img => img.src)
      .filter(src => src && src.startsWith('http')); // Filter valid HTTP sources

    // Remove duplicates
    const uniqueImages = [...new Set(images)];
    
    console.log(`Media Downloader: ${uniqueImages.length} images detected.`);
    sendResponse({ images: uniqueImages });
  }
  return true; // Keep the message channel open for async response
});
