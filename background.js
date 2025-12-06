// background.js (V2.3) - Updated for new website layout

console.log('[BarebonesBgV2.3] Background script loaded.'); // Version marker

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getDownloadUrlFromPage(tabId, videoPageUrl) {
  console.log(`[BarebonesBgV2.3][Tab ${tabId}] Processing: ${videoPageUrl}`); // Version marker

  // Extract video ID from URL (format: /video/title_VIDEO_ID)
  const urlMatch = videoPageUrl.match(/\/video\/[^_]+_([a-f0-9]+)/);
  if (!urlMatch) {
    console.error(`[BarebonesBgV2.3][Tab ${tabId}] Could not extract video ID from URL: ${videoPageUrl}`);
    throw new Error('Could not extract video ID from URL');
  }
  
  const videoId = urlMatch[1];
  const downloadUrl = `https://pmvhaven.com/api/videos/${videoId}/download?quality=original`;
  
  console.log(`[BarebonesBgV2.3][Tab ${tabId}] Constructed download URL: ${downloadUrl}`);
  
  // Extract title and artist from the page for better filename
  try {
    console.log(`[BarebonesBgV2.3][Tab ${tabId}] Extracting title and artist from page...`);
    const metadataResults = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return new Promise((resolve, reject) => {
          let attempts = 0;
          const maxAttempts = 60; // 60 attempts × 500ms = 30 seconds

          const intervalId = setInterval(() => {
            // Extract title from h1 with specific video title styling
            // Look for h1 with these classes that indicate it's the video title
            const titleElement = document.querySelector('h1.text-xl.font-bold.text-white') || 
                                 document.querySelector('h1.font-bold.text-white');
            
            // Extract artist from h3 with gradient text styling
            const artistElement = document.querySelector('h3.font-semibold.inline-flex.items-center.gap-1\\.5.bg-gradient-to-r.from-orange-400.to-amber-400.bg-clip-text.text-transparent');
            
            if (titleElement && artistElement) {
              clearInterval(intervalId);
              
              const title = titleElement.textContent.trim();
              // Get just the artist name (before any badges/icons)
              const artistText = artistElement.childNodes[0]?.textContent?.trim() || artistElement.textContent.split('\n')[0].trim();
              
              console.log('Extracted metadata - Title:', title, 'Artist:', artistText);
              resolve({ title, artist: artistText });
              return;
            }
            
            attempts++;
            if (attempts >= maxAttempts) {
              clearInterval(intervalId);
              console.warn('Could not extract title/artist after 30s, will use fallback');
              resolve({ title: null, artist: null });
            }
          }, 500);
        });
      }
    });

    const metadata = metadataResults?.[0]?.result || { title: null, artist: null };
    console.log(`[BarebonesBgV2.3][Tab ${tabId}] Extracted metadata:`, metadata);
    
    return { downloadUrl, title: metadata.title, artist: metadata.artist };
    
  } catch (e) {
    const errorMessage = e.message || "Unknown error during metadata extraction";
    console.error(`[BarebonesBgV2.3][Tab ${tabId}] Error during metadata extraction: ${errorMessage}`);
    if (e.stack) console.error(e.stack.substring(0, 500));
    // Return URL without metadata if extraction fails
    return { downloadUrl, title: null, artist: null };
  }
}


chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'downloadSelected' && msg.urls && msg.urls.length > 0) {
    sendResponse({ status: 'Processing started. Check background console.' });
    console.log(`[BarebonesBgV2.3] Received ${msg.urls.length} URLs to process.`); // Version marker

    (async () => {
      for (let i = 0; i < msg.urls.length; i++) {
        const videoUrl = msg.urls[i];
        console.log(`[BarebonesBgV2.3] ------ Starting URL ${i + 1}/${msg.urls.length}: ${videoUrl} ------`); // Version marker
        let tabId;
        try {
          const tab = await chrome.tabs.create({ url: videoUrl, active: false });
          tabId = tab.id;

          // Wait for tab to load (listen for 'complete' status)
          await new Promise((resolve, reject) => {
            const listener = (updatedTabId, changeInfo, tabInfo) => {
                if (updatedTabId === tabId && changeInfo.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);
                    chrome.tabs.onRemoved.removeListener(removedTabListener); // Clean up removed listener
                    clearTimeout(timeoutId); // Clear the timeout
                    console.log(`[BarebonesBgV2.3][Tab ${tabId}] Tab loaded successfully.`); // Version marker
                    resolve();
                }
            };
            const timeoutId = setTimeout(() => { // Timeout to prevent hanging indefinitely
                chrome.tabs.onUpdated.removeListener(listener);
                chrome.tabs.onRemoved.removeListener(removedTabListener); // Clean up removed listener
                console.warn(`[BarebonesBgV2.3][Tab ${tabId}] Tab load timeout after 60s, proceeding anyway but might fail.`); // Version marker
                resolve(); // Resolve to proceed, failure will be caught by subsequent steps
            }, 60000); // 60s timeout for tab load - generous for slow connections

            // Handle cases where tab is removed before loading, or errors during load
            const removedTabListener = function(removedTabId) {
              if (removedTabId === tabId) {
                chrome.tabs.onUpdated.removeListener(listener);
                chrome.tabs.onRemoved.removeListener(removedTabListener); // Clean itself up
                clearTimeout(timeoutId);
                console.error(`[BarebonesBgV2.3][Tab ${tabId}] Tab was closed before loading completed.`); // Version marker
                reject(new Error(`Tab ${tabId} was closed before loading completed.`));
              }
            };
            chrome.tabs.onRemoved.addListener(removedTabListener);
            chrome.tabs.onUpdated.addListener(listener);
          });
          
          const result = await getDownloadUrlFromPage(tabId, videoUrl); // Returns {downloadUrl, title, artist}

          if (result && result.downloadUrl) {
            console.log(`[BarebonesBgV2.3][Tab ${tabId}] Initiating download for: ${result.downloadUrl}`);
            
            // Create filename from artist and title
            let filename;
            if (result.artist && result.title) {
              // Sanitize for filename - only remove filesystem-illegal characters, keep UTF-8
              const sanitize = (str) => {
                return str
                  // Remove control characters (0x00-0x1F, 0x7F-0x9F)
                  .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
                  // Remove filesystem-illegal characters: < > : " / \ | ? *
                  .replace(/[<>:"/\\|?*]/g, '')
                  // Replace multiple spaces with single space
                  .replace(/\s+/g, ' ')
                  // Trim whitespace
                  .trim()
                  // Limit length to avoid filesystem issues (max 200 chars, leaving room for path)
                  .substring(0, 200);
              };
              
              const artist = sanitize(result.artist);
              const title = sanitize(result.title);
              filename = `${artist} - ${title}.mp4`;
              console.log(`[BarebonesBgV2.3][Tab ${tabId}] Using filename: ${filename}`);
            } else {
              // Fallback to video ID from URL
              const urlParts = videoUrl.split('/');
              const videoIdFromUrl = urlParts[urlParts.length -1] || urlParts[urlParts.length -2] || 'video_file';
              const filenameSuffix = videoIdFromUrl.replace(/[^a-zA-Z0-9.-]/g, '_');
              filename = `${filenameSuffix || 'download'}.mp4`;
              console.log(`[BarebonesBgV2.3][Tab ${tabId}] Using fallback filename: ${filename}`);
            }
            
            chrome.downloads.download({
              url: result.downloadUrl,
              filename: `pmvhaven_downloads/${filename}`
            });
            console.log(`[BarebonesBgV2.3][Tab ${tabId}] Download command issued for ${result.downloadUrl}`);
          } else {
            console.error(`[BarebonesBgV2.3][Tab ${tabId}] No download URL obtained for ${videoUrl}.`);
          }

        } catch (err) {
          console.error(`[BarebonesBgV2.3][Tab ${tabId || 'N/A'}] Failed processing ${videoUrl}:`, err.message, err.stack ? err.stack.substring(0,300) : ''); // Version marker
          console.log(`[BarebonesBgV2.3] Continuing to next video despite error...`);
        } finally {
          if (tabId) {
            try {
                // Wait to ensure download has started
                await delay(2000); 
                // Check if tab still exists before trying to remove
                const currentTabInfo = await chrome.tabs.get(tabId).catch(() => null);
                if (currentTabInfo) {
                    await chrome.tabs.remove(tabId);
                    console.log(`[BarebonesBgV2.3][Tab ${tabId}] Tab closed.`); // Version marker
                } else {
                    console.log(`[BarebonesBgV2.3][Tab ${tabId}] Tab already closed or does not exist, no removal needed.`);
                }
            } catch (e) { 
              console.warn(`[BarebonesBgV2.3][Tab ${tabId}] Failed to close tab:`, e.message);
            }
          }
          console.log(`[BarebonesBgV2.3] ------ Finished URL ${i + 1}/${msg.urls.length}: ${videoUrl} ------`); // Version marker
          if (i < msg.urls.length - 1) {
            console.log(`[BarebonesBgV2.3] Waiting 1s before next video...`);
            await delay(1000); // Short delay between processing URLs
          }
        }
      }
      console.log('[BarebonesBgV2.3] All URLs processed.'); // Version marker
    })();
    return true; // Indicates async response
  }
  return false;
});