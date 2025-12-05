/* -------------------------------------------------
 * PMV Haven Downloader – Elegant Edition (content.js)
 * -------------------------------------------------
 * UI overhaul: glassy dark panel, big thumbnails,
 * MutationObserver auto-refresh, generous logging.
 * Updated for new website layout.
 * -------------------------------------------------
 */

(() => {
  console.log('[PMV-Elegant] content.js boot…');

  // Prevent double-injection on SPA route swaps.
  if (document.getElementById('pmv-downloader-panel')) return;

  /* ----------  1.  Shadow-DOM panel skeleton  ---------- */
  const host = document.createElement('div');
  host.id = 'pmv-downloader-panel';
  host.style.cssText = 'all:unset; position:fixed; top:64px; right:24px; z-index:99999;';
  document.body.appendChild(host);

  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = /* html */`
    <style>
      :host {
        --accent: #ff9800;
        --bg: rgba(20,20,20,0.95);
        --border: #555;
        --txt: #e0e0e0;
        --txt-dim: #9e9e9e;
        font-family: "Segoe UI", Roboto, sans-serif;
      }
      .panel {
        width: 340px; max-height: 80vh; display:flex; flex-direction:column;
        background: var(--bg); border:1px solid var(--border); border-radius:12px;
        backdrop-filter: blur(6px);
        overflow:hidden;
      }
      header {
        display:flex; justify-content:space-between; align-items:center; padding:10px 14px;
        background: rgba(35,35,35,0.85); border-bottom:1px solid var(--border);
        user-select: none; cursor:move;
      }
      header h4 { margin:0; font-size:15px; color:var(--accent); font-weight:600; }
      header button {
        background:none; border:none; color:var(--txt); font-size:17px; line-height:1;
        cursor:pointer; padding:2px 4px;
      }
      .controls { display:flex; gap:8px; padding:12px 14px; flex-wrap:wrap; }
      .controls button {
        flex:1 1 48%; padding:6px 8px; border-radius:6px; border:1px solid var(--border);
        background:#303030; color:var(--txt); font-weight:600; cursor:pointer;
        transition:background .2s ease;
      }
      .controls button:hover { background:#424242; }
      .controls .primary { background:var(--accent); border-color:var(--accent); color:#222; }
      .controls .primary:hover { background:#ffa726; }
      .list {
        overflow-y:auto; padding:0 6px 10px 14px; flex:1;
      }
      .item {
        display:grid; grid-template-columns:96px 1fr 24px; align-items:center;
        gap:10px; margin-bottom:10px; border-bottom:1px dashed #444; padding-bottom:8px;
      }
      .thumb {
        width:96px; height:54px; object-fit:cover; border-radius:6px;
      }
      .meta { overflow:hidden; }
      .title {
        font-size:14px; color:var(--txt); font-weight:600;
        white-space:nowrap; text-overflow:ellipsis; overflow:hidden;
      }
      .extras {
        font-size:12px; color:var(--txt-dim); margin-top:2px;
        display:flex; gap:8px; flex-wrap:wrap;
      }
      input[type="checkbox"] { transform:scale(1.2); cursor:pointer; }
      /* Simple scrollbar glow */
      .list::-webkit-scrollbar { width:6px; }
      .list::-webkit-scrollbar-thumb { background:var(--accent); border-radius:3px; }
    </style>

    <div class="panel">
      <header>
        <h4>PMV Downloader</h4>
        <button id="close">×</button>
      </header>
      <div class="controls">
        <button id="refresh">Refresh Links</button>
        <button id="toggle">Select All</button>
        <button id="download" class="primary">Download</button>
      </div>
      <div class="list" id="list"></div>
    </div>
  `;

  /* ----------  2.  Draggable header  ---------- */
  (() => {
    const dragArea = root.querySelector('header');
    let offsetX = 0, offsetY = 0, dragging = false;

    const start = (e) => {
      dragging = true;
      const rect = host.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', stop);
    };
    const move = (e) => {
      if (!dragging) return;
      host.style.left = `${e.clientX - offsetX}px`;
      host.style.top  = `${e.clientY - offsetY}px`;
    };
    const stop = () => {
      dragging = false;
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', stop);
    };
    dragArea.addEventListener('mousedown', start, { passive:true });
  })();

  /* ----------  3.  Dom handles  ---------- */
  const $ = (sel) => root.querySelector(sel);
  const listEl = $('#list');

  /* ----------  4.  Link scanner (UPDATED)  ---------- */
  function scanLinks() {
    console.log('[PMV-Elegant] Scanning DOM for video links...');
    
    // Try multiple selectors to catch the video links
    const selectors = [
      'a[href^="/video/"]',  // Original selector
      'a[href*="/video/"]',  // More permissive
    ];
    
    let anchors = [];
    for (const selector of selectors) {
      const found = Array.from(document.querySelectorAll(selector));
      if (found.length > 0) {
        anchors = found;
        console.log(`[PMV-Elegant] Found ${found.length} links using selector: ${selector}`);
        break;
      }
    }
    
    if (anchors.length === 0) {
      console.warn('[PMV-Elegant] No video links found with any selector');
      return [];
    }
    
    const unique = new Map();

    anchors.forEach(a => {
      let href = a.getAttribute('href');
      if (!href || !href.includes('/video/')) return;
      
      // Remove query parameters for deduplication
      const cleanHref = href.split('?')[0];
      const fullUrl = new URL(cleanHref, location.origin).href;
      
      if (unique.has(fullUrl)) return; // de-dupe

      // Thumbnail heuristics - look more broadly
      let img = a.querySelector('img');
      if (!img) {
        // Try looking in parent or sibling elements
        const parent = a.parentElement;
        if (parent) {
          img = parent.querySelector('img');
        }
      }
      if (!img) {
        // fallback: maybe the video preview poster
        const video = a.querySelector('video');
        if (video?.poster) {
          img = { src: video.poster };
        }
      }
      
      const thumbSrc = img?.src || '';
      
      // Try to get title from multiple sources
      let title = '';
      
      // Check img alt
      if (img?.alt) title = img.alt;
      
      // Check for h3 or h2 titles in the link
      if (!title) {
        const heading = a.querySelector('h3, h2, h1');
        if (heading) title = heading.textContent.trim();
      }
      
      // Check for title in parent
      if (!title) {
        const parent = a.parentElement;
        if (parent) {
          const heading = parent.querySelector('h3, h2, h1');
          if (heading) title = heading.textContent.trim();
        }
      }
      
      // Fallback to link text
      if (!title) {
        title = a.textContent.trim();
      }
      
      // Final fallback
      if (!title || title.length < 3) {
        title = 'Untitled';
      }
      
      // Clean up title (remove extra whitespace and newlines)
      title = title.replace(/\s+/g, ' ').trim();

      console.log(`[PMV-Elegant] Found video: "${title}" -> ${fullUrl}`);
      unique.set(fullUrl, { thumbSrc, title });
    });

    const result = Array.from(unique.values()).map((data, i) => ({ 
      ...data, 
      url: Array.from(unique.keys())[i] 
    }));
    
    console.log(`[PMV-Elegant] Total unique videos found: ${result.length}`);
    return result;
  }

  /* ----------  5.  Render list  ---------- */
  function render() {
    console.log('[PMV-Elegant] Rendering video list...');
    const links = scanLinks();
    listEl.innerHTML = '';

    if (!links.length) {
      listEl.innerHTML = '<p style="color:var(--txt-dim);text-align:center;margin:20px 0;">No video links found. Try scrolling the page or refreshing.</p>';
      console.warn('[PMV-Elegant] No videos to render');
      return;
    }

    links.forEach(({ url, thumbSrc, title }) => {
      const item = document.createElement('div');
      item.className = 'item';
      item.innerHTML = `
        <img class="thumb" src="${thumbSrc || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%2260%22%3E%3Crect fill=%22%23333%22 width=%22100%22 height=%2260%22/%3E%3C/svg%3E'}" alt="">
        <div class="meta">
          <div class="title" title="${title}">${title}</div>
          <div class="extras">
            ${thumbSrc ? '<span>📷</span>' : ''}
            <span>${new URL(url).pathname.split('/').pop().slice(0, 8).toUpperCase()}</span>
          </div>
        </div>
        <input type="checkbox" data-url="${url}">
      `;
      listEl.appendChild(item);
    });

    console.log(`[PMV-Elegant] Rendered ${links.length} item(s).`);
  }

  /* ----------  6.  Button wiring  ---------- */
  $('#close').addEventListener('click', () => {
    console.log('[PMV-Elegant] Closing panel');
    host.remove();
  });
  
  $('#refresh').addEventListener('click', () => {
    console.log('[PMV-Elegant] Manual refresh triggered');
    render();
  });

  $('#toggle').addEventListener('click', () => {
    const boxes = listEl.querySelectorAll('input[type="checkbox"]');
    const allChecked = Array.from(boxes).every(b => b.checked);
    boxes.forEach(b => (b.checked = !allChecked));
    console.log(`[PMV-Elegant] Toggled all checkboxes to: ${!allChecked}`);
  });

  $('#download').addEventListener('click', () => {
    const urls = Array.from(listEl.querySelectorAll('input:checked')).map(b => b.dataset.url);
    if (!urls.length) {
      alert('No videos selected.');
      console.warn('[PMV-Elegant] Download clicked but no videos selected');
      return;
    }
    console.log('[PMV-Elegant] Pushing', urls.length, 'URL(s) to background:', urls);
    chrome.runtime.sendMessage({ action: 'downloadSelected', urls }, (res) => {
      if (chrome.runtime.lastError) {
        console.error('[PMV-Elegant] BG comms error:', chrome.runtime.lastError.message);
        alert('Background script error: ' + chrome.runtime.lastError.message);
      } else {
        console.log('[PMV-Elegant] BG response:', res);
        alert(`Downloading ${urls.length} video(s)…  Check the Chrome downloads shelf.`);
      }
    });
  });

  /* ----------  7.  Auto-refresh on DOM mutations & route changes  ---------- */
  const debounced = (() => {
    let id; return (fn, ms = 400) => { clearTimeout(id); id = setTimeout(fn, ms); };
  })();

  const obs = new MutationObserver(() => {
    console.log('[PMV-Elegant] DOM mutation detected, debouncing refresh...');
    debounced(render);
  });
  obs.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('popstate', () => {
    console.log('[PMV-Elegant] Route change detected, debouncing refresh...');
    debounced(render);
  });

  /* ----------  8.  Initial paint  ---------- */
  // Wait a bit for the page to fully load
  setTimeout(() => {
    console.log('[PMV-Elegant] Initial render starting...');
    render();
    console.log('[PMV-Elegant] UI ready.');
  }, 1000);
})();