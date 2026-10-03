import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open } from '@tauri-apps/plugin-dialog';
import type { LoadReport, Progress } from './types';

export const desktop = isTauri();
export async function chooseFolders(): Promise<string[]> {
  if (!desktop) throw new Error('フォルダの読み込みはデスクトップアプリで利用できます。');
  const selected = await open({ directory: true, multiple: true, title: 'PAKの読み込み元を追加' });
  return selected ? (Array.isArray(selected) ? selected : [selected]) : [];
}
export function normalizeSources(paths: string[]): Promise<string[]> {
  return invoke('normalize_sources', { paths });
}
export function loadSources(paths: string[], progress: (p: Progress) => void): Promise<LoadReport> {
  const onProgress = new Channel<Progress>();
  onProgress.onmessage = progress;
  return invoke('load_sources', { paths, onProgress });
}
export async function listenDrop(callback: (paths: string[]) => void): Promise<() => void> {
  if (!desktop) return () => {};
  return getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === 'drop') callback(event.payload.paths);
  });
}
