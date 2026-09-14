const KEY = "lare:recording-group";
interface GroupState {
  tabId: number;
  groupId: number | null;
  previous: {
    id: number;
    title?: string;
    color: chrome.tabGroups.TabGroup["color"];
    collapsed: boolean;
  } | null;
  repairs: number;
}
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn);
  chain = run.catch(() => undefined);
  return run;
}
async function read(): Promise<GroupState | null> {
  return ((await chrome.storage.local.get(KEY))[KEY] as GroupState | undefined) ?? null;
}
async function paint(state: GroupState) {
  const groupId = await chrome.tabs.group({ tabIds: [state.tabId] });
  await chrome.storage.local.set({ [KEY]: { ...state, groupId } });
  await chrome.tabGroups.update(groupId, {
    color: "red",
    title: "Lare - Recording",
    collapsed: false,
  });
}
export function startGroup(tabId: number) {
  return serial(async () => {
    const tab = await chrome.tabs.get(tabId);
    const previous = tab.groupId !== -1 ? await chrome.tabGroups.get(tab.groupId) : null;
    const state: GroupState = { tabId, groupId: null, previous, repairs: 0 };
    await chrome.storage.local.set({ [KEY]: state });
    await paint(state);
  });
}
export function repairGroup() {
  return serial(async () => {
    const state = await read();
    if (!state) return;
    const tab = await chrome.tabs.get(state.tabId).catch(() => null);
    if (!tab || tab.groupId === state.groupId || state.repairs >= 1) return;
    await paint({ ...state, repairs: state.repairs + 1 });
  });
}
export function restoreGroup() {
  return serial(async () => {
    const state = await read();
    if (!state) return;
    const tab = await chrome.tabs.get(state.tabId).catch(() => null);
    // If the user deliberately regrouped it, their latest choice wins.
    if (tab && tab.groupId === state.groupId) {
      if (!state.previous) await chrome.tabs.ungroup([state.tabId]);
      else {
        const previous = await chrome.tabGroups.get(state.previous.id).catch(() => null);
        if (previous && previous.windowId === tab.windowId) {
          await chrome.tabs.group({ tabIds: [state.tabId], groupId: previous.id });
        } else {
          const id = await chrome.tabs.group({ tabIds: [state.tabId] });
          const { title, color, collapsed } = state.previous;
          await chrome.tabGroups.update(id, { title: title ?? "", color, collapsed });
        }
      }
    }
    await chrome.storage.local.remove(KEY);
  });
}
