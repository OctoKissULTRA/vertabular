const pinnedList = document.getElementById('pinned-list');
const pinnedContainer = document.getElementById('pinned-tabs-container');
const mainList = document.getElementById('main-list');
const searchInput = document.getElementById('search-input');

// UI Elements
const contextMenu = document.getElementById('context-menu');
const newTabBtn = document.getElementById('new-tab-btn');
const workspacesBtn = document.getElementById('workspaces-btn');
const workspacesOverlay = document.getElementById('workspaces-overlay');
const closeWorkspacesBtn = document.getElementById('close-workspaces-btn');
const saveWorkspaceBtn = document.getElementById('save-workspace-btn');
const workspaceNameInput = document.getElementById('workspace-name-input');
const workspacesList = document.getElementById('workspaces-list');

// Settings Elements
const settingsBtn = document.getElementById('settings-btn');
const settingsOverlay = document.getElementById('settings-overlay');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const focusModeToggle = document.getElementById('focus-mode-toggle');
const openAppearanceBtn = document.getElementById('open-appearance-btn');
const hibernateAllBtn = document.getElementById('hibernate-all-btn');

let allTabs = [];
let allGroups = [];
let focusedTabId = null;
let contextMenuTargetId = null;

// --- INITIALIZATION ---

async function init() {
    await migrateToSyncStorage(); // Cloud Sync Migration
    await fetchTabsAndGroups();
    renderAll();
    setupListeners();
    setupContextMenu();
    setupWorkspaces();
    setupSettings();
}

async function fetchTabsAndGroups() {
    [allTabs, allGroups] = await Promise.all([
        chrome.tabs.query({ currentWindow: true }),
        chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT })
    ]);
}

// --- CLOUD SYNC ---

async function migrateToSyncStorage() {
    // Check if we have local data but no sync data (First run after update)
    const local = await chrome.storage.local.get(['sessions', 'workspaces']); // Handle legacy 'sessions' key too
    const sync = await chrome.storage.sync.get('workspaces');
    
    // If we have legacy 'sessions' in local, migrate to 'workspaces' in sync
    if ((local.sessions || local.workspaces) && !sync.workspaces) {
        const dataToMigrate = local.workspaces || local.sessions;
        try {
            await chrome.storage.sync.set({ workspaces: dataToMigrate });
            // Optional: Clear local to save space, but let's keep as backup for now
            console.log('Migrated workspaces to Cloud Sync');
        } catch (e) {
            console.warn('Sync storage full or error, staying on local for now', e);
        }
    }
}

// Helper to get workspaces from Sync (fallback to Local)
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
        alert('Cloud Storage Full! Saving locally instead.');
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

    if (pinnedTabs.length > 0) {
        pinnedContainer.style.display = 'block';
        pinnedTabs.forEach(tab => pinnedList.appendChild(createTabElement(tab)));
    } else {
        pinnedContainer.style.display = 'none';
    }

    if (query.length > 0) {
        normalTabs.forEach(tab => mainList.appendChild(createTabElement(tab)));
    } else {
        let processedGroupIds = new Set();
        normalTabs.sort((a, b) => a.index - b.index);

        for (let i = 0; i < normalTabs.length; i++) {
            const tab = normalTabs[i];
            
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
                    } else {
                        mainList.appendChild(createTabElement(tab));
                    }
                }
            } else {
                mainList.appendChild(createTabElement(tab));
            }
        }
    }
    
    if (focusedTabId) {
        const el = document.getElementById(`tab-${focusedTabId}`);
        if (el) el.classList.add('keyboard-focused');
    }
}

function createGroupHeader(group) {
    const div = document.createElement('div');
    div.className = 'group-header';
    div.onclick = () => {};
    
    const colors = {
        grey: '#bdc1c6', blue: '#8ab4f8', red: '#f28b82', yellow: '#fdd663',
        green: '#81c995', pink: '#ff8bcb', purple: '#c58af9', cyan: '#78d9ec', orange: '#fcad70'
    };
    const color = colors[group.color] || colors['grey'];

    div.innerHTML = `
        <div class="group-dot" style="background-color: ${color}"></div>
        <span class="group-title">${group.title || 'Group'}</span>
    `;
    return div;
}

function createTabElement(tab, inGroup = false) {
    const div = document.createElement('div');
    div.className = `tab-item ${tab.active ? 'active' : ''} ${inGroup ? 'in-group' : ''} ${tab.audible ? 'playing' : ''} ${tab.discarded ? 'discarded' : ''}`;
    div.id = `tab-${tab.id}`;
    div.title = tab.title;
    
    div.draggable = true;
    div.dataset.tabId = tab.id;
    div.dataset.index = tab.index;

    const urlForFavicon = tab.url || 'chrome://newtab';
    const faviconUrl = chrome.runtime.getURL(`_favicon/?pageUrl=${encodeURIComponent(urlForFavicon)}&size=32`);
    
    const audioIcon = `<svg class="secondary-icon audio-icon" viewBox="0 0 24 24"><path d="M14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77zm-4 0a8.978 8.978 0 0 0-5 6.71v.01c0 4.28 2.99 7.86 7 8.77v-2.06c-2.89-.86-5-3.54-5-6.71s2.11-5.85 5-6.71V3.23zM9 13H5v-2h4V5l5 7-5 7v-6z"/></svg>`;
    const closeIcon = `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
    const leafIcon = tab.discarded ? `<span class="memory-saver-indicator">zzz</span>` : '';

    div.innerHTML = `
        <img src="${faviconUrl}" class="favicon" />
        <span class="title">${tab.title}</span>
        ${leafIcon}
        ${tab.audible ? audioIcon : ''}
        <button class="close-btn">${closeIcon}</button>
    `;

    div.onclick = (e) => {
        if (!e.target.closest('.close-btn')) {
            chrome.tabs.update(tab.id, { active: true });
            focusedTabId = tab.id; 
            renderAll();
        }
    };

    div.querySelector('.close-btn').onclick = (e) => {
        e.stopPropagation();
        chrome.tabs.remove(tab.id);
    };

    div.oncontextmenu = (e) => {
        e.preventDefault();
        showContextMenu(e, tab);
    };
    
    div.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', tab.id);
        div.classList.add('dragging');
    });

    div.addEventListener('dragend', () => {
        div.classList.remove('dragging');
        clearDragIndicators();
    });

    div.addEventListener('dragover', (e) => {
        e.preventDefault();
        const bounding = div.getBoundingClientRect();
        const offset = bounding.y + (bounding.height / 2);
        clearDragIndicators();
        if (e.clientY - offset > 0) {
            div.classList.add('drag-over-bottom');
        } else {
            div.classList.add('drag-over-top');
        }
    });

    div.addEventListener('drop', async (e) => {
        e.preventDefault();
        const sourceId = parseInt(e.dataTransfer.getData('text/plain'));
        const targetId = tab.id;
        if (sourceId === targetId) return;
        const bounding = div.getBoundingClientRect();
        const offset = bounding.y + (bounding.height / 2);
        const dropAfter = (e.clientY - offset > 0);
        let newIndex = tab.index;
        if (dropAfter) newIndex++;
        await chrome.tabs.move(sourceId, { index: newIndex });
    });

    return div;
}

function clearDragIndicators() {
    document.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
        el.classList.remove('drag-over-top');
        el.classList.remove('drag-over-bottom');
    });
}

// --- CONTEXT MENU ---

function showContextMenu(e, tab) {
    contextMenuTargetId = tab.id;
    let x = e.clientX;
    let y = e.clientY;
    if (x + 180 > window.innerWidth) x -= 180;
    if (y + 250 > window.innerHeight) y -= 250;
    
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.classList.remove('hidden');
    
    document.getElementById('ctx-mute').textContent = tab.mutedInfo.muted ? 'Unmute Site' : 'Mute Site';
    document.getElementById('ctx-pin').textContent = tab.pinned ? 'Unpin Tab' : 'Pin Tab';
    
    // Hibernate text check
    document.getElementById('ctx-hibernate').textContent = tab.discarded ? 'Wake Tab' : 'Hibernate';
}

function setupContextMenu() {
    document.addEventListener('click', (e) => {
        if (!contextMenu.contains(e.target)) {
            contextMenu.classList.add('hidden');
        }
    });
    
    // Header New Tab Button
    newTabBtn.onclick = () => chrome.tabs.create({});

    document.getElementById('ctx-new-tab').onclick = () => chrome.tabs.create({});
    document.getElementById('ctx-pin').onclick = async () => {
        const tab = await chrome.tabs.get(contextMenuTargetId);
        chrome.tabs.update(contextMenuTargetId, { pinned: !tab.pinned });
        contextMenu.classList.add('hidden');
    };
    
    // Toggle Fullscreen (Context Menu)
    document.getElementById('ctx-fullscreen').onclick = async () => {
         const win = await chrome.windows.getCurrent();
         const state = win.state === 'fullscreen' ? 'normal' : 'fullscreen';
         chrome.windows.update(win.id, { state });
         contextMenu.classList.add('hidden');
    };
    
    // HIBERNATION Logic
    document.getElementById('ctx-hibernate').onclick = async () => {
        const tab = await chrome.tabs.get(contextMenuTargetId);
        if (!tab.active) {
            chrome.tabs.discard(contextMenuTargetId);
        }
        contextMenu.classList.add('hidden');
    };

    document.getElementById('ctx-mute').onclick = async () => {
        const tab = await chrome.tabs.get(contextMenuTargetId);
        chrome.tabs.update(contextMenuTargetId, { muted: !tab.mutedInfo.muted });
        contextMenu.classList.add('hidden');
    };
    document.getElementById('ctx-duplicate').onclick = () => {
        chrome.tabs.duplicate(contextMenuTargetId);
        contextMenu.classList.add('hidden');
    };
    document.getElementById('ctx-group').onclick = () => {
        chrome.tabs.group({ tabIds: contextMenuTargetId });
        contextMenu.classList.add('hidden');
    };
    document.getElementById('ctx-close').onclick = () => {
        chrome.tabs.remove(contextMenuTargetId);
        contextMenu.classList.add('hidden');
    };
    document.getElementById('ctx-close-others').onclick = async () => {
        const tabs = await chrome.tabs.query({ currentWindow: true });
        const toRemove = tabs.filter(t => t.id !== contextMenuTargetId && !t.pinned).map(t => t.id);
        chrome.tabs.remove(toRemove);
        contextMenu.classList.add('hidden');
    };
}

// --- WORKSPACES (CLOUD SYNCED) ---

function setupWorkspaces() {
    workspacesBtn.onclick = () => {
        workspacesOverlay.classList.remove('hidden');
        renderWorkspacesList();
    };
    
    closeWorkspacesBtn.onclick = () => workspacesOverlay.classList.add('hidden');
    
    saveWorkspaceBtn.onclick = async () => {
        const name = workspaceNameInput.value.trim() || `Workspace ${new Date().toLocaleString()}`;
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
    };
}

async function renderWorkspacesList() {
    const workspaces = await getWorkspaces();
    workspacesList.innerHTML = '';
    
    if (workspaces.length === 0) {
        workspacesList.innerHTML = '<div style="padding:20px; text-align:center; color:var(--secondary-text)">No synced workspaces</div>';
        return;
    }
    
    workspaces.forEach(ws => {
        const div = document.createElement('div');
        div.className = 'workspace-item';
        div.innerHTML = `
            <div class="workspace-info">
                <div class="workspace-name">${ws.name}</div>
                <div class="workspace-meta">${ws.tabs.length} Tabs • ${ws.date}</div>
            </div>
            <div class="workspace-actions">
                <button class="btn-switch" title="Open in this window">Switch</button>
                <button class="btn-mobile" title="Send to Phone (Bookmarks)">
                    <svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:currentColor;"><path d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z"/></svg>
                </button>
                <button class="btn-delete" title="Delete">✕</button>
            </div>
        `;
        
        // SWITCH WORKSPACE Logic
        div.querySelector('.btn-switch').onclick = async () => {
            if (confirm(`Switching to "${ws.name}" will close current tabs. Continue?`)) {
                const oldTabs = await chrome.tabs.query({ currentWindow: true });
                const oldIds = oldTabs.map(t => t.id);
                
                const first = await chrome.tabs.create({ url: ws.tabs[0].url, pinned: ws.tabs[0].pinned });
                
                for (let i = 1; i < ws.tabs.length; i++) {
                    chrome.tabs.create({ url: ws.tabs[i].url, pinned: ws.tabs[i].pinned, active: false });
                }
                
                chrome.tabs.remove(oldIds);
                workspacesOverlay.classList.add('hidden');
            }
        };

        // MOBILE SYNC Logic
        div.querySelector('.btn-mobile').onclick = async () => {
            const folderName = "Vertabular Mobile";
            
            // 1. Find or Create Main Folder
            const search = await chrome.bookmarks.search({ title: folderName });
            let parentId;
            
            if (search.length > 0) {
                parentId = search[0].id;
            } else {
                // Create in "Mobile Bookmarks" if possible, else "Other Bookmarks"
                // Standard chrome extension root is usually '1' (Bookmarks Bar) or '2' (Other)
                // We'll just create it at top level or under "Other Bookmarks"
                const created = await chrome.bookmarks.create({ title: folderName });
                parentId = created.id;
            }
            
            // 2. Create Workspace Folder
            const wsFolder = await chrome.bookmarks.create({ parentId: parentId, title: ws.name });
            
            // 3. Add bookmarks
            for (const t of ws.tabs) {
                await chrome.bookmarks.create({ parentId: wsFolder.id, title: t.title, url: t.url });
            }
            
            alert(`Synced to Bookmarks!\n\nOpen Chrome on your phone -> Bookmarks -> "${folderName}" to access.`);
        };
        
        div.querySelector('.btn-delete').onclick = async () => {
            const current = await getWorkspaces();
            const filtered = current.filter(w => w.id !== ws.id);
            await saveWorkspaces(filtered);
            renderWorkspacesList();
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

    closeSettingsBtn.onclick = () => settingsOverlay.classList.add('hidden');

    focusModeToggle.onchange = async () => {
        const state = focusModeToggle.checked ? 'fullscreen' : 'normal';
        const window = await chrome.windows.getCurrent();
        chrome.windows.update(window.id, { state: state });
    };

    openAppearanceBtn.onclick = () => {
        chrome.tabs.create({ url: 'chrome://settings/appearance' });
        settingsOverlay.classList.add('hidden');
    };
    
    // Hibernate All Logic
    hibernateAllBtn.onclick = async () => {
        const tabs = await chrome.tabs.query({ currentWindow: true, active: false }); // Only background tabs
        for (const tab of tabs) {
            chrome.tabs.discard(tab.id);
        }
        alert(`Hibernated ${tabs.length} background tabs.`);
    };
}

// --- LISTENERS ---

function setupListeners() {
    searchInput.addEventListener('input', renderAll);
    
    document.addEventListener('keydown', (e) => {
        if (document.activeElement === searchInput || document.activeElement === workspaceNameInput) {
            if (e.key === 'Escape') {
                document.activeElement.blur();
                e.preventDefault();
            }
            return;
        }

        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            navigateList(e.key === 'ArrowDown' ? 1 : -1);
        } else if (e.key === 'Enter') {
            if (focusedTabId) {
                chrome.tabs.update(focusedTabId, { active: true });
            }
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            if (focusedTabId) {
                chrome.tabs.remove(focusedTabId);
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
        visibleTabs.push(id);
    });
    
    if (visibleTabs.length === 0) return;

    let currentIndex = visibleTabs.indexOf(focusedTabId);
    if (currentIndex === -1) {
        currentIndex = 0;
    } else {
        currentIndex += direction;
    }

    if (currentIndex < 0) currentIndex = 0;
    if (currentIndex >= visibleTabs.length) currentIndex = visibleTabs.length - 1;

    focusedTabId = visibleTabs[currentIndex];
    
    document.querySelectorAll('.keyboard-focused').forEach(el => el.classList.remove('keyboard-focused'));
    const el = document.getElementById(`tab-${focusedTabId}`);
    if (el) {
        el.classList.add('keyboard-focused');
        el.scrollIntoView({ block: 'nearest' });
    }
}

// --- EVENTS ---

const events = [
    chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated,
    chrome.tabs.onMoved, chrome.tabs.onActivated, chrome.tabs.onDetached,
    chrome.tabs.onAttached, chrome.tabGroups.onCreated, chrome.tabGroups.onRemoved,
    chrome.tabGroups.onUpdated, chrome.tabGroups.onMoved
];

function handleUpdate() {
    fetchTabsAndGroups().then(renderAll);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading') return;
    handleUpdate();
});

chrome.windows.onBoundsChanged.addListener(async (window) => {
    if (!settingsOverlay.classList.contains('hidden')) {
         const w = await chrome.windows.getCurrent();
         focusModeToggle.checked = (w.state === 'fullscreen');
    }
});

events.forEach(event => {
    if (event !== chrome.tabs.onUpdated) {
        // @ts-ignore
        event.addListener(handleUpdate);
    }
});

init();
