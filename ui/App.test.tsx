import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import * as api from './api';
import { testReport } from './fixtures';
import type { LoadReport, Progress } from './types';

vi.mock('./api', () => ({
  desktop: true,
  chooseFolders: vi.fn(),
  normalizeSources: vi.fn(),
  loadSources: vi.fn(),
  listenDrop: vi.fn(),
}));
vi.mock('./GraphView', () => ({
  default: ({ root }: { root: string }) => <div>探索中:{root}</div>,
}));
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.chooseFolders).mockResolvedValue(['C:\\pak']);
  vi.mocked(api.normalizeSources).mockImplementation(async (paths) => paths);
  vi.mocked(api.loadSources).mockResolvedValue(testReport());
  vi.mocked(api.listenDrop).mockResolvedValue(() => {});
});
async function addAndLoad() {
  fireEvent.click(screen.getByRole('button', { name: 'フォルダを追加' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '読み込みを開始' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '読み込みを開始' }));
  await screen.findByText('読み込みが完了しました');
}

describe('application flow', () => {
  it('loads, searches, previews and returns from graph to source settings', async () => {
    render(<App />);
    expect(screen.getByRole('button', { name: '読み込みを開始' })).toBeDisabled();
    await addAndLoad();
    fireEvent.click(screen.getByRole('button', { name: '起点を選択する' }));
    fireEvent.change(screen.getByRole('textbox', { name: '名前で検索' }), {
      target: { value: 'store' },
    });
    fireEvent.click(screen.getByRole('button', { name: /デパート\s*store/ }));
    expect(screen.getByText('要求する貨物')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'この産業から表示' }));
    expect(screen.getByText('探索中:industry:store')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: '探索方向' }), {
      target: { value: 'downstream' },
    });
    expect(screen.getByText('下流の生産・消費関係')).toBeInTheDocument();
    expect(api.loadSources).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '起点変更' }));
    fireEvent.click(screen.getByRole('tab', { name: /貨物/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '名前で検索' }), {
      target: { value: '小麦' },
    });
    fireEvent.click(screen.getByRole('button', { name: /小麦\s*grain/ }));
    fireEvent.click(screen.getByRole('button', { name: 'この貨物から表示' }));
    expect(screen.getByText('探索中:goods:grain')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '読み込み設定' }));
    expect(screen.getByRole('heading', { name: '産業チェーンを、読み込む。' })).toBeInTheDocument();
  });
  it('deduplicates directories, reorders and removes them', async () => {
    vi.mocked(api.chooseFolders).mockResolvedValue(['C:\\pak', 'C:\\addon']);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'フォルダを追加' }));
    await screen.findByText('addon');
    fireEvent.click(screen.getByRole('button', { name: 'フォルダを追加' }));
    await waitFor(() => expect(api.normalizeSources).toHaveBeenCalledTimes(2));
    expect(screen.getAllByText('addon')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'addonを上へ' }));
    fireEvent.click(screen.getByRole('button', { name: '読み込みを開始' }));
    await screen.findByText('読み込みが完了しました');
    expect(api.loadSources).toHaveBeenCalledWith(['C:\\addon', 'C:\\pak'], expect.any(Function));
    fireEvent.click(screen.getByRole('button', { name: 'addonを削除' }));
    expect(screen.getByText('構成を変更しました。再読み込みが必要です。')).toBeInTheDocument();
  });
  it('shows progress and prevents double loads', async () => {
    let complete!: (value: LoadReport) => void;
    let onProgress!: (value: Progress) => void;
    vi.mocked(api.loadSources).mockImplementation((_paths, callback) => {
      onProgress = callback;
      return new Promise((resolve) => {
        complete = resolve;
      });
    });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'フォルダを追加' }));
    await screen.findByText('pak');
    fireEvent.click(screen.getByRole('button', { name: '読み込みを開始' }));
    expect(screen.getByRole('button', { name: '読み込み中' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'フォルダを追加' })).toBeDisabled();
    const { act } = await import('react');
    await act(async () => {
      onProgress({ completed: 1, total: 2, file: 'test.pak' });
    });
    expect(screen.getByText('1 / 2 ファイル')).toBeInTheDocument();
    await act(async () => {
      complete(testReport());
    });
    expect(api.loadSources).toHaveBeenCalledTimes(1);
  });
  it('preserves previous valid data after a failed reload and shows empty results', async () => {
    render(<App />);
    await addAndLoad();
    vi.mocked(api.loadSources).mockResolvedValue({
      ...testReport(),
      data: { industries: {}, goods: {} },
      files_loaded: 0,
      files_failed: 1,
      incomplete: true,
      diagnostics: [
        {
          severity: 'error',
          code: 'pak_error',
          message: 'PAKが破損しています',
          object_id: null,
          source: null,
        },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: '読み込みを開始' }));
    await screen.findByText('PAKが破損しています');
    expect(screen.getByRole('alert')).toHaveTextContent('利用できる産業・貨物がありません');
    fireEvent.click(screen.getByRole('button', { name: '前回の解析結果を開く' }));
    fireEvent.change(screen.getByRole('textbox', { name: '名前で検索' }), {
      target: { value: '見つからない名前' },
    });
    expect(screen.getByText('一致する項目がありません')).toBeInTheDocument();
    expect(within(screen.getByRole('tablist')).getAllByText('3')).toHaveLength(2);
  });
  it('only accepts native folder drops while source settings is active', async () => {
    let drop!: (paths: string[]) => void;
    vi.mocked(api.listenDrop).mockImplementation(async (callback) => {
      drop = callback;
      return () => {};
    });
    render(<App />);
    const { act } = await import('react');
    await act(async () => {
      drop(['C:\\pak']);
    });
    expect(screen.getByText('pak')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '読み込みを開始' }));
    await screen.findByText('読み込みが完了しました');
    fireEvent.click(screen.getByRole('button', { name: '起点を選択する' }));
    await act(async () => {
      drop(['C:\\ignored']);
    });
    expect(api.normalizeSources).toHaveBeenCalledTimes(1);
  });
});
