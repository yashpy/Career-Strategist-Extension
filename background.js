// Service worker: open the side panel when the toolbar icon is clicked.

chrome.runtime.onInstalled.addListener(() => {
  // Make the toolbar button open the side panel.
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("setPanelBehavior failed:", err));
});

// Fallback for browsers/versions where openPanelOnActionClick isn't honored.
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (err) {
    console.error("sidePanel.open failed:", err);
  }
});
