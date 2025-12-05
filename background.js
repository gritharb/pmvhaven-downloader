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
          const maxAttempts = 40; // Increased from 20 to 40 (20 seconds)

          const intervalId = setInterval(() => {
            // Extract title from h1
            const titleElement = document.querySelector('h1[data-v-1404a3d0]');
            // Extract artist from h3 with gradient text
            const artistElement = document.querySelector('h3.font-semibold.inline-flex');
            
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
              console.warn('Could not extract title/artist after 20s, will use fallback');
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
      const BATCH_SIZE = 10;
      const batches = [];
      
      // Split URLs into batches of 10
      for (let i = 0; i < msg.urls.length; i += BATCH_SIZE) {
        batches.push(msg.urls.slice(i, i + BATCH_SIZE));
      }
      
      console.log(`[BarebonesBgV2.3] Processing ${msg.urls.length} videos in ${batches.length} batches of up to ${BATCH_SIZE}`);
      
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        console.log(`[BarebonesBgV2.3] ====== Starting Batch ${batchIndex + 1}/${batches.length} (${batch.length} videos) ======`);
        
        // Process all videos in this batch concurrently
        const batchPromises = batch.map(async (videoUrl, indexInBatch) => {
          const overallIndex = batchIndex * BATCH_SIZE + indexInBatch;
          console.log(`[BarebonesBgV2.3] ------ Starting URL ${overallIndex + 1}/${msg.urls.length}: ${videoUrl} ------`);
          let tabId;
          
          try {
            const tab = await chrome.tabs.create({ url: videoUrl, active: false });
            tabId = tab.id;

            // Wait for tab to load (listen for 'complete' status)
            await new Promise((resolve, reject) => {
              const listener = (updatedTabId, changeInfo, tabInfo) => {
                  if (updatedTabId === tabId && changeInfo.status === 'complete') {
                      chrome.tabs.onUpdated.removeListener(listener);
                      chrome.tabs.onRemoved.removeListener(removedTabListener);
                      clearTimeout(timeoutId);
                      console.log(`[BarebonesBgV2.3][Tab ${tabId}] Tab loaded successfully.`);
                      resolve();
                  }
              };
              const timeoutId = setTimeout(() => {
                  chrome.tabs.onUpdated.removeListener(listener);
                  chrome.tabs.onRemoved.removeListener(removedTabListener);
                  console.warn(`[BarebonesBgV2.3][Tab ${tabId}] Tab load timeout after 40s, proceeding anyway but might fail.`);
                  resolve();
              }, 40000); // 40s timeout for tab load

              const removedTabListener = function(removedTabId) {
                if (removedTabId === tabId) {
                  chrome.tabs.onUpdated.removeListener(listener);
                  chrome.tabs.onRemoved.removeListener(removedTabListener);
                  clearTimeout(timeoutId);
                  console.error(`[BarebonesBgV2.3][Tab ${tabId}] Tab was closed before loading completed.`);
                  reject(new Error(`Tab ${tabId} was closed before loading completed.`));
                }
              };
              chrome.tabs.onRemoved.addListener(removedTabListener);
              chrome.tabs.onUpdated.addListener(listener);
            });
            
            const result = await getDownloadUrlFromPage(tabId, videoUrl);

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
            console.error(`[BarebonesBgV2.3][Tab ${tabId || 'N/A'}] Failed processing ${videoUrl}:`, err.message, err.stack ? err.stack.substring(0,300) : '');
            console.log(`[BarebonesBgV2.3] Continuing with batch despite error...`);
          } finally {
            if (tabId) {
              try {
                  // Wait to ensure download has started
                  await delay(2000); 
                  // Check if tab still exists before trying to remove
                  const currentTabInfo = await chrome.tabs.get(tabId).catch(() => null);
                  if (currentTabInfo) {
                      await chrome.tabs.remove(tabId);
                      console.log(`[BarebonesBgV2.3][Tab ${tabId}] Tab closed.`);
                  } else {
                      console.log(`[BarebonesBgV2.3][Tab ${tabId}] Tab already closed or does not exist, no removal needed.`);
                  }
              } catch (e) { 
                console.warn(`[BarebonesBgV2.3][Tab ${tabId}] Failed to close tab:`, e.message);
              }
            }
            console.log(`[BarebonesBgV2.3] ------ Finished URL ${overallIndex + 1}/${msg.urls.length}: ${videoUrl} ------`);
          }
        });
        
        // Wait for all videos in this batch to complete
        await Promise.all(batchPromises);
        console.log(`[BarebonesBgV2.3] ====== Completed Batch ${batchIndex + 1}/${batches.length} ======`);
        
        // Wait between batches
        if (batchIndex < batches.length - 1) {
          console.log(`[BarebonesBgV2.3] Waiting 3s before next batch...`);
          await delay(3000);
        }
      }
      
      console.log('[BarebonesBgV2.3] All URLs processed.');
    })();
    return true; // Indicates async response
  }
  return false;
});