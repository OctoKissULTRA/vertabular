// Vertabular Service Worker
// Handles side panel activation and tab count badge

// Open side panel on extension icon click
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

// --- TAB COUNT BADGE ---

async function updateBadge() {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const count = tabs.length;

    // Show count on badge
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });

    // Use Chrome's blue color for badge
    chrome.action.setBadgeBackgroundColor({ color: '#1a73e8' });
    chrome.action.setBadgeTextColor({ color: '#ffffff' });
  } catch (e) {
    // Silently handle errors (e.g., when window is closing)
  }
}

// Update badge on tab events
chrome.tabs.onCreated.addListener(updateBadge);
chrome.tabs.onRemoved.addListener(updateBadge);
chrome.tabs.onAttached.addListener(updateBadge);
chrome.tabs.onDetached.addListener(updateBadge);

// Update badge when switching windows
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    updateBadge();
  }
});

// Initial badge update
updateBadge();
