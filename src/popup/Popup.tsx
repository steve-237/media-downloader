import { useEffect, useState } from 'react';

export default function Popup() {
  const [images, setImages] = useState<string[]>([]);

  useEffect(() => {
    // Request content script to scan for images on the active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs: chrome.tabs.Tab[]) => {
      const activeTab = tabs[0];
      if (activeTab && activeTab.id) {
        chrome.tabs.sendMessage(activeTab.id, { action: "SCAN_IMAGES" }, (response: any) => {
          if (chrome.runtime.lastError) {
            console.warn("Could not connect to content script. Please refresh the page.");
            return;
          }
          if (response && response.images) {
            setImages(response.images);
          }
        });
      }
    });
  }, []);

  return (
    <div className="flex flex-col h-full w-full p-4">
      <h1 className="text-xl font-bold mb-4 text-blue-600">Media Downloader</h1>
      <div className="flex-1 overflow-y-auto pr-2">
        <h2 className="text-sm font-semibold mb-2 text-slate-500">
          Detected Images ({images.length})
        </h2>
        {images.length === 0 ? (
          <div className="flex items-center justify-center h-48">
            <p className="text-sm text-slate-400 text-center">No images found or page still loading.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {images.map((src, idx) => (
              <div key={idx} className="group relative aspect-square bg-slate-100 rounded-lg overflow-hidden border border-slate-200 hover:border-blue-400 transition-colors shadow-sm">
                <img src={src} alt="detected" className="object-cover w-full h-full group-hover:scale-105 transition-transform" />
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="mt-4 pt-4 border-t border-slate-200">
        <button 
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg shadow-md transition-all active:scale-95 disabled:opacity-50"
          disabled={images.length === 0}
        >
          Download All
        </button>
      </div>
    </div>
  );
}
