/**
 * Vertabular - Minimal Vertical Tabs for Chrome
 * A privacy-first, native-feeling tab manager
 */

// --- DOM ELEMENTS ---
const pinnedList = document.getElementById('pinned-list');
const pinnedContainer = document.getElementById('pinned-tabs-container');
const mainList = document.getElementById('main-list');
const searchInput = document.getElementById('search-input');
const toastContainer = document.getElementById('toast-container');

// UI Elements
const contextMenu = document.getElementById('context-menu');
const newTabBtn = document.getElementById('new-tab-btn');
const workspacesBtn = document.getElementById('workspaces-btn');
const workspacesOverlay = document.getElementById('workspaces-overlay');
const closeWorkspacesBtn = document.getElementById('close-workspaces-btn');
const saveWorkspaceBtn = document.getElementById('save-workspace-btn');
const workspaceNameInput = document.getElementById('workspace-name-input');
const workspacesList = document.getElementById('workspaces-list');
const exportWorkspacesBtn = document.getElementById('export-workspaces-btn');

// Settings Elements
const settingsBtn = document.getElementById('settings-btn');
const settingsOverlay = document.getElementById('settings-overlay');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const focusModeToggle = document.getElementById('focus-mode-toggle');
const openAppearanceBtn = document.getElementById('open-appearance-btn');
const hibernateAllBtn = document.getElementById('hibernate-all-btn');
const closeDuplicatesBtn = document.getElementById('close-duplicates-btn');

// --- STATE ---
let allTabs = [];
let allGroups = [];
let focusedTabId = null;
let contextMenuTargetId = null;
let updateTimeout = null;

// Undo close tab history
const closedTabsHistory = [];
const MAX_CLOSED_HISTORY = 20;

// --- INITIALIZATION ---

async function init() {
  await migrateToSyncStorage();
  await fetchTabsAndGroups();
  renderAll();
  setupListeners();
  setupContextMenu();
  setupWorkspaces();
  setupSettings();
}

async function fetchTabsAndGroups() {
  try {
    [allTabs, allGroups] = await Promise.all([
      chrome.tabs.query({ currentWindow: true }),
      chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT })
    ]);
  } catch (e) {
    console.error('Failed to fetch tabs:', e);
    allTabs = [];
    allGroups = [];
  }
}

// --- TOAST NOTIFICATIONS ---

function showToast(message, options = {}) {
  const { action, actionLabel, duration = 3000 } = options;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <span class="toast-message">${message}</span>
    ${action ? `<button class="toast-action">${actionLabel || 'Undo'}</button>` : ''}
  `;

  if (action) {
    toast.querySelector('.toast-action').onclick = () => {
      action();
      toast.remove();
    };
  }

  toastContainer.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) {
      toast.remove();
    }
  }, duration);

  return toast;
}

// --- CLOUD SYNC ---

async function migrateToSyncStorage() {
  try {
    const local = await chrome.storage.local.get(['sessions', 'workspaces']);
    const sync = await chrome.storage.sync.get('workspaces');

    if ((local.sessions || local.workspaces) && !sync.workspaces) {
      const dataToMigrate = local.workspaces || local.sessions;
      await chrome.storage.sync.set({ workspaces: dataToMigrate });
      console.log('Migrated workspaces to Cloud Sync');
    }
  } catch (e) {
    console.warn('Migration check failed:', e);
  }
}

async function getWorkspaces() {
  try {
    const data = await chrome.storage.sync.get('workspaces');
    return data.workspaces || [];
  } catch (e) {
    const data = await chrome.storage.local.get('workspaces');
    return data.workspaces || [];
  }
}

async function saveWorkspaces(workspaces) {
  try {
    await chrome.storage.sync.set({ workspaces });
  } catch (e) {
    showToast('Cloud storage full, saving locally');
    await chrome.storage.local.set({ workspaces });
  }
}

// --- RENDERING ---

function renderAll() {
  if (document.startViewTransition) {
    document.startViewTransition(() => performRender());
  } else {
    performRender();
  }
}

function performRender() {
  const query = searchInput.value.toLowerCase();
  const filteredTabs = allTabs.filter(tab =>
    tab.title.toLowerCase().includes(query) ||
    tab.url.toLowerCase().includes(query)
  );

  pinnedList.innerHTML = '';
  mainList.innerHTML = '';

  const pinnedTabs = filteredTabs.filter(t => t.pinned);
  const normalTabs = filteredTabs.filter(t => !t.pinned);

  // Pinned section
  if (pinnedTabs.length > 0) {
    pinnedContainer.classList.remove('hidden');
    pinnedTabs.forEach(tab => pinnedList.appendChild(createTabElement(tab)));
  } else {
    pinnedContainer.classList.add('hidden');
  }

  // Main tabs section
  if (query.length > 0) {
    // When searching, show flat list
    normalTabs.forEach(tab => mainList.appendChild(createTabElement(tab)));
  } else {
    // Normal view with groups
    const processedGroupIds = new Set();
    normalTabs.sort((a, b) => a.index - b.index);

    for (const tab of normalTabs) {
      if (tab.groupId !== -1) {
        if (!processedGroupIds.has(tab.groupId)) {
          const group = allGroups.find(g => g.id === tab.groupId);
          if (group) {
            mainList.appendChild(createGroupHeader(group));
            const groupTabs = normalTabs.filter(t => t.groupId === tab.groupId);
            groupTabs.forEach(gTab => {
              mainList.appendChild(createTabElement(gTab, true));
            });
            processedGroupIds.add(tab.groupId);
          }
        }
      } else {
        mainList.appendChild(createTabElement(tab));
      }
    }
  }

  // Restore keyboard focus
  if (focusedTabId) {
    const el = document.getElementById(`tab-${focusedTabId}`);
    if (el) el.classList.add('keyboard-focused');
  }
}

function createGroupHeader(group) {
  const div = document.createElement('div');
  div.className = 'group-header';
  div.setAttribute('role', 'heading');
  div.setAttribute('aria-level', '2');

  const colors = {
    grey: '#80868b', blue: '#8ab4f8', red: '#f28b82', yellow: '#fdd663',
    green: '#81c995', pink: '#ff8bcb', purple: '#c58af9', cyan: '#78d9ec', orange: '#fcad70'
  };
  const color = colors[group.color] || colors.grey;

  div.innerHTML = `
    <div class="group-dot" style="background-color: ${color}" aria-hidden="true"></div>
    <span class="group-title">${escapeHtml(group.title || 'Group')}</span>
  `;

  return div;
}

function createTabElement(tab, inGroup = false) {
  const div = document.createElement('div');
  div.className = `tab-item${tab.active ? ' active' : ''}${inGroup ? ' in-group' : ''}${tab.audible ? ' playing' : ''}${tab.discarded ? ' discarded' : ''}`;
  div.id = `tab-${tab.id}`;
  div.setAttribute('role', 'tab');
  div.setAttribute('aria-selected', tab.active ? 'true' : 'false');
  div.setAttribute('aria-label', tab.title);
  div.tabIndex = 0;
  div.draggable = true;
  div.dataset.tabId = tab.id;
  div.dataset.index = tab.index;

  const urlForFavicon = tab.url || 'chrome://newtab';
  const faviconUrl = chrome.runtime.getURL(`_favicon/?pageUrl=${encodeURIComponent(urlForFavicon)}&size=32`);

  const audioIcon = `<svg class="secondary-icon audio-icon" viewBox="0 0 24 24" aria-label="Playing audio"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>`;
  const closeIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
  const hibernateIndicator = tab.discarded ? `<span class="memory-saver-indicator" title="Hibernated">zzz</span>` : '';

  div.innerHTML = `
    <img src="${faviconUrl}" class="favicon" alt="" loading="lazy">
    <span class="title">${escapeHtml(tab.title)}</span>
    ${hibernateIndicator}
    ${tab.audible ? audioIcon : ''}
    <button class="close-btn" aria-label="Close tab">${closeIcon}</button>
  `;

  // Click to activate
  div.onclick = (e) => {
    if (!e.target.closest('.close-btn')) {
      chrome.tabs.update(tab.id, { active: true });
      focusedTabId = tab.id;
      renderAll();
    }
  };

  // Close button
  div.querySelector('.close-btn').onclick = (e) => {
    e.stopPropagation();
    closeTabWithUndo(tab);
  };

  // Context menu
  div.oncontextmenu = (e) => {
    e.preventDefault();
    showContextMenu(e, tab);
  };

  // Drag and drop
  div.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', tab.id);
    e.dataTransfer.effectAllowed = 'move';
    div.classList.add('dragging');
  });

  div.addEventListener('dragend', () => {
    div.classList.remove('dragging');
    clearDragIndicators();
  });

  div.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const bounding = div.getBoundingClientRect();
    const offset = bounding.y + (bounding.height / 2);
    clearDragIndicators();
    if (e.clientY - offset > 0) {
      div.classList.add('drag-over-bottom');
    } else {
      div.classList.add('drag-over-top');
    }
  });

  div.addEventListener('dragleave', () => {
    div.classList.remove('drag-over-top', 'drag-over-bottom');
  });

  div.addEventListener('drop', async (e) => {
    e.preventDefault();
    clearDragIndicators();
    const sourceId = parseInt(e.dataTransfer.getData('text/plain'));
    const targetId = tab.id;
    if (sourceId === targetId) return;

    const bounding = div.getBoundingClientRect();
    const offset = bounding.y + (bounding.height / 2);
    const dropAfter = (e.clientY - offset > 0);
    let newIndex = tab.index;
    if (dropAfter) newIndex++;

    try {
      await chrome.tabs.move(sourceId, { index: newIndex });
    } catch (e) {
      showToast('Failed to move tab');
    }
  });

  return div;
}

function clearDragIndicators() {
  document.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
    el.classList.remove('drag-over-top', 'drag-over-bottom');
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- UNDO CLOSE TAB ---

function closeTabWithUndo(tab) {
  // Save to history before closing
  closedTabsHistory.unshift({
    url: tab.url,
    title: tab.title,
    pinned: tab.pinned,
    closedAt: Date.now()
  });

  // Trim history
  if (closedTabsHistory.length > MAX_CLOSED_HISTORY) {
    closedTabsHistory.pop();
  }

  chrome.tabs.remove(tab.id);

  showToast(`Closed "${truncate(tab.title, 30)}"`, {
    action: undoCloseTab,
    actionLabel: 'Undo'
  });
}

function undoCloseTab() {
  const lastClosed = closedTabsHistory.shift();
  if (lastClosed) {
    chrome.tabs.create({
      url: lastClosed.url,
      pinned: lastClosed.pinned
    });
    showToast('Tab restored');
  } else {
    showToast('No tabs to restore');
  }
}

function truncate(str, length) {
  return str.length > length ? str.substring(0, length) + '...' : str;
}

// --- CONTEXT MENU ---

function showContextMenu(e, tab) {
  contextMenuTargetId = tab.id;
  let x = e.clientX;
  let y = e.clientY;

  // Prevent menu from going off-screen
  const menuWidth = 200;
  const menuHeight = 320;
  if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 8;
  if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 8;
  if (x < 8) x = 8;
  if (y < 8) y = 8;

  contextMenu.style.left = `${x}px`;
  contextMenu.style.top = `${y}px`;
  contextMenu.classList.remove('hidden');

  // Update dynamic text
  const muteEl = document.getElementById('ctx-mute').querySelector('.menu-item-text');
  const pinEl = document.getElementById('ctx-pin').querySelector('.menu-item-text');
  const hibernateEl = document.getElementById('ctx-hibernate').querySelector('.menu-item-text');

  if (muteEl) muteEl.textContent = tab.mutedInfo?.muted ? 'Unmute Site' : 'Mute Site';
  if (pinEl) pinEl.textContent = tab.pinned ? 'Unpin Tab' : 'Pin Tab';
  if (hibernateEl) hibernateEl.textContent = tab.discarded ? 'Wake Tab' : 'Hibernate';
}

function hideContextMenu() {
  contextMenu.classList.add('hidden');
}

function setupContextMenu() {
  // Close menu on click outside
  document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target)) {
      hideContextMenu();
    }
  });

  // Close on escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !contextMenu.classList.contains('hidden')) {
      hideContextMenu();
    }
  });

  // New tab button
  newTabBtn.onclick = () => chrome.tabs.create({});

  // Context menu actions
  document.getElementById('ctx-new-tab').onclick = () => {
    chrome.tabs.create({});
    hideContextMenu();
  };

  document.getElementById('ctx-pin').onclick = async () => {
    try {
      const tab = await chrome.tabs.get(contextMenuTargetId);
      await chrome.tabs.update(contextMenuTargetId, { pinned: !tab.pinned });
    } catch (e) {
      showToast('Failed to pin tab');
    }
    hideContextMenu();
  };

  document.getElementById('ctx-fullscreen').onclick = async () => {
    try {
      const win = await chrome.windows.getCurrent();
      const state = win.state === 'fullscreen' ? 'normal' : 'fullscreen';
      await chrome.windows.update(win.id, { state });
    } catch (e) {
      showToast('Failed to toggle fullscreen');
    }
    hideContextMenu();
  };

  document.getElementById('ctx-hibernate').onclick = async () => {
    try {
      const tab = await chrome.tabs.get(contextMenuTargetId);
      if (tab.discarded) {
        // Wake up by navigating to the URL
        await chrome.tabs.update(contextMenuTargetId, { url: tab.url });
      } else if (!tab.active) {
        await chrome.tabs.discard(contextMenuTargetId);
        showToast('Tab hibernated');
      } else {
        showToast('Cannot hibernate active tab');
      }
    } catch (e) {
      showToast('Failed to hibernate tab');
    }
    hideContextMenu();
  };

  document.getElementById('ctx-mute').onclick = async () => {
    try {
      const tab = await chrome.tabs.get(contextMenuTargetId);
      await chrome.tabs.update(contextMenuTargetId, { muted: !tab.mutedInfo?.muted });
    } catch (e) {
      showToast('Failed to mute tab');
    }
    hideContextMenu();
  };

  document.getElementById('ctx-duplicate').onclick = () => {
    chrome.tabs.duplicate(contextMenuTargetId);
    hideContextMenu();
  };

  document.getElementById('ctx-group').onclick = () => {
    chrome.tabs.group({ tabIds: contextMenuTargetId });
    hideContextMenu();
  };

  document.getElementById('ctx-close').onclick = async () => {
    const tab = allTabs.find(t => t.id === contextMenuTargetId);
    if (tab) {
      closeTabWithUndo(tab);
    }
    hideContextMenu();
  };

  document.getElementById('ctx-close-others').onclick = async () => {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const toRemove = tabs.filter(t => t.id !== contextMenuTargetId && !t.pinned).map(t => t.id);
    if (toRemove.length > 0) {
      await chrome.tabs.remove(toRemove);
      showToast(`Closed ${toRemove.length} tabs`);
    }
    hideContextMenu();
  };
}

// --- WORKSPACES ---

function setupWorkspaces() {
  workspacesBtn.onclick = () => {
    workspacesOverlay.classList.remove('hidden');
    renderWorkspacesList();
    workspaceNameInput.focus();
  };

  closeWorkspacesBtn.onclick = () => {
    workspacesOverlay.classList.add('hidden');
  };

  saveWorkspaceBtn.onclick = async () => {
    const name = workspaceNameInput.value.trim() || `Workspace ${new Date().toLocaleDateString()}`;
    const tabs = await chrome.tabs.query({ currentWindow: true });

    const workspace = {
      id: Date.now().toString(),
      name: name,
      date: new Date().toLocaleDateString(),
      tabs: tabs.map(t => ({ url: t.url, title: t.title, pinned: t.pinned }))
    };

    const workspaces = await getWorkspaces();
    workspaces.unshift(workspace);
    await saveWorkspaces(workspaces);

    workspaceNameInput.value = '';
    renderWorkspacesList();
    showToast(`Saved "${name}" with ${tabs.length} tabs`);
  };

  // Export workspaces
  exportWorkspacesBtn.onclick = async () => {
    const workspaces = await getWorkspaces();
    if (workspaces.length === 0) {
      showToast('No workspaces to export');
      return;
    }

    const data = JSON.stringify(workspaces, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `vertabular-workspaces-${Date.now()}.json`;
    a.click();

    URL.revokeObjectURL(url);
    showToast(`Exported ${workspaces.length} workspaces`);
  };

  // Close overlay on escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!workspacesOverlay.classList.contains('hidden')) {
        workspacesOverlay.classList.add('hidden');
      }
    }
  });
}

async function renderWorkspacesList() {
  const workspaces = await getWorkspaces();
  workspacesList.innerHTML = '';

  if (workspaces.length === 0) {
    workspacesList.innerHTML = `
      <div class="workspace-empty">
        <svg class="workspace-empty-icon" viewBox="0 0 24 24"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/></svg>
        <p class="workspace-empty-text">No saved workspaces yet.<br>Save your current tabs to get started.</p>
      </div>
    `;
    return;
  }

  workspaces.forEach(ws => {
    const div = document.createElement('div');
    div.className = 'workspace-item';
    div.setAttribute('role', 'listitem');
    div.innerHTML = `
      <div class="workspace-icon">
        <svg viewBox="0 0 24 24"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/></svg>
      </div>
      <div class="workspace-info">
        <div class="workspace-name">${escapeHtml(ws.name)}</div>
        <div class="workspace-meta">${ws.tabs.length} tabs &middot; ${ws.date}</div>
      </div>
      <div class="workspace-actions">
        <button class="workspace-action-btn btn-switch" title="Open workspace" aria-label="Open workspace">
          <svg viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
        </button>
        <button class="workspace-action-btn btn-mobile" title="Sync to bookmarks for mobile" aria-label="Sync to mobile">
          <svg viewBox="0 0 24 24"><path d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z"/></svg>
        </button>
        <button class="workspace-action-btn btn-delete danger" title="Delete workspace" aria-label="Delete workspace">
          <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        </button>
      </div>
    `;

    // Switch workspace
    div.querySelector('.btn-switch').onclick = async () => {
      if (confirm(`Open "${ws.name}"? This will close your current tabs.`)) {
        const oldTabs = await chrome.tabs.query({ currentWindow: true });
        const oldIds = oldTabs.map(t => t.id);

        // Open new tabs
        for (let i = 0; i < ws.tabs.length; i++) {
          await chrome.tabs.create({
            url: ws.tabs[i].url,
            pinned: ws.tabs[i].pinned,
            active: i === 0
          });
        }

        // Close old tabs
        await chrome.tabs.remove(oldIds);
        workspacesOverlay.classList.add('hidden');
        showToast(`Opened "${ws.name}"`);
      }
    };

    // Mobile sync
    div.querySelector('.btn-mobile').onclick = async () => {
      try {
        const folderName = 'Vertabular Mobile';

        // Find or create folder
        const search = await chrome.bookmarks.search({ title: folderName });
        let parentId;

        if (search.length > 0) {
          parentId = search[0].id;
        } else {
          const created = await chrome.bookmarks.create({ title: folderName });
          parentId = created.id;
        }

        // Create workspace folder
        const wsFolder = await chrome.bookmarks.create({ parentId, title: ws.name });

        // Add bookmarks
        for (const t of ws.tabs) {
          await chrome.bookmarks.create({
            parentId: wsFolder.id,
            title: t.title,
            url: t.url
          });
        }

        showToast(`Synced to bookmarks! Open Chrome on your phone to access.`);
      } catch (e) {
        showToast('Failed to sync to bookmarks');
      }
    };

    // Delete
    div.querySelector('.btn-delete').onclick = async () => {
      const current = await getWorkspaces();
      const filtered = current.filter(w => w.id !== ws.id);
      await saveWorkspaces(filtered);
      renderWorkspacesList();
      showToast(`Deleted "${ws.name}"`);
    };

    workspacesList.appendChild(div);
  });
}

// --- SETTINGS ---

function setupSettings() {
  settingsBtn.onclick = async () => {
    settingsOverlay.classList.remove('hidden');
    const window = await chrome.windows.getCurrent();
    focusModeToggle.checked = (window.state === 'fullscreen');
  };

  closeSettingsBtn.onclick = () => {
    settingsOverlay.classList.add('hidden');
  };

  focusModeToggle.onchange = async () => {
    const state = focusModeToggle.checked ? 'fullscreen' : 'normal';
    const window = await chrome.windows.getCurrent();
    await chrome.windows.update(window.id, { state });
  };

  openAppearanceBtn.onclick = () => {
    chrome.tabs.create({ url: 'chrome://settings/appearance' });
    settingsOverlay.classList.add('hidden');
  };

  // Hibernate all
  hibernateAllBtn.onclick = async () => {
    const tabs = await chrome.tabs.query({ currentWindow: true, active: false });
    let count = 0;

    for (const tab of tabs) {
      if (!tab.discarded) {
        try {
          await chrome.tabs.discard(tab.id);
          count++;
        } catch (e) {
          // Some tabs can't be discarded
        }
      }
    }

    showToast(`Hibernated ${count} tabs`);
  };

  // Close duplicates
  closeDuplicatesBtn.onclick = async () => {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const seen = new Map();
    const toClose = [];

    for (const tab of tabs) {
      // Normalize URL (ignore hash and trailing slash)
      const url = tab.url.split('#')[0].replace(/\/$/, '');

      if (seen.has(url)) {
        toClose.push(tab.id);
      } else {
        seen.set(url, tab.id);
      }
    }

    if (toClose.length > 0) {
      await chrome.tabs.remove(toClose);
      showToast(`Closed ${toClose.length} duplicate tabs`);
    } else {
      showToast('No duplicate tabs found');
    }
  };

  // Close on escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !settingsOverlay.classList.contains('hidden')) {
      settingsOverlay.classList.add('hidden');
    }
  });
}

// --- KEYBOARD NAVIGATION ---

function setupListeners() {
  // Debounced search
  searchInput.addEventListener('input', () => {
    if (updateTimeout) clearTimeout(updateTimeout);
    updateTimeout = setTimeout(renderAll, 50);
  });

  document.addEventListener('keydown', (e) => {
    // Skip if typing in input
    if (document.activeElement === searchInput || document.activeElement === workspaceNameInput) {
      if (e.key === 'Escape') {
        document.activeElement.blur();
        e.preventDefault();
      }
      return;
    }

    // Undo close tab
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      undoCloseTab();
      return;
    }

    // Arrow navigation
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      navigateList(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      if (focusedTabId) {
        chrome.tabs.update(focusedTabId, { active: true });
      }
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (focusedTabId && document.activeElement.tagName !== 'INPUT') {
        const tab = allTabs.find(t => t.id === focusedTabId);
        if (tab) closeTabWithUndo(tab);
      }
    } else if (e.key === '/') {
      e.preventDefault();
      searchInput.focus();
    }
  });
}

function navigateList(direction) {
  const visibleTabs = [];
  document.querySelectorAll('.tab-item').forEach(el => {
    const id = parseInt(el.id.replace('tab-', ''));
    if (!isNaN(id)) visibleTabs.push(id);
  });

  if (visibleTabs.length === 0) return;

  let currentIndex = visibleTabs.indexOf(focusedTabId);
  if (currentIndex === -1) {
    currentIndex = direction > 0 ? 0 : visibleTabs.length - 1;
  } else {
    currentIndex += direction;
  }

  // Clamp to bounds
  currentIndex = Math.max(0, Math.min(currentIndex, visibleTabs.length - 1));

  focusedTabId = visibleTabs[currentIndex];

  // Update visual focus
  document.querySelectorAll('.keyboard-focused').forEach(el => el.classList.remove('keyboard-focused'));
  const el = document.getElementById(`tab-${focusedTabId}`);
  if (el) {
    el.classList.add('keyboard-focused');
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

// --- DEBOUNCED UPDATE HANDLER ---

function handleUpdate() {
  if (updateTimeout) clearTimeout(updateTimeout);
  updateTimeout = setTimeout(async () => {
    await fetchTabsAndGroups();
    renderAll();
  }, 50);
}

// --- CHROME EVENTS ---

// Tab events
chrome.tabs.onCreated.addListener(handleUpdate);
chrome.tabs.onRemoved.addListener(handleUpdate);
chrome.tabs.onMoved.addListener(handleUpdate);
chrome.tabs.onActivated.addListener(handleUpdate);
chrome.tabs.onDetached.addListener(handleUpdate);
chrome.tabs.onAttached.addListener(handleUpdate);

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // Only update on meaningful changes
  if (changeInfo.status === 'loading') return;
  if (changeInfo.title || changeInfo.url || changeInfo.pinned !== undefined ||
      changeInfo.audible !== undefined || changeInfo.discarded !== undefined) {
    handleUpdate();
  }
});

// Tab group events
chrome.tabGroups.onCreated.addListener(handleUpdate);
chrome.tabGroups.onRemoved.addListener(handleUpdate);
chrome.tabGroups.onUpdated.addListener(handleUpdate);
chrome.tabGroups.onMoved.addListener(handleUpdate);

// Window state for focus mode
chrome.windows.onBoundsChanged.addListener(async () => {
  if (!settingsOverlay.classList.contains('hidden')) {
    const w = await chrome.windows.getCurrent();
    focusModeToggle.checked = (w.state === 'fullscreen');
  }
});

// --- INITIALIZE ---
init();
