import type { Goods } from './types';

export function categoryKey(good: Goods): string {
  return good.category_id == null ? 'unknown' : String(good.category_id);
}
export function categoryLabel(good: Goods): string {
  if (good.category_id == null) return 'カテゴリ不明';
  if (good.category_id === 0) return '専用貨物';
  return good.category_name || `カテゴリ ${good.category_id}`;
}
export function categoryOptions(goods: Goods[]): { key: string; label: string }[] {
  const unique = new Map(goods.map((good) => [categoryKey(good), categoryLabel(good)]));
  const order = (key: string) => (key === 'unknown' ? 257 : key === '0' ? 256 : Number(key));
  return [...unique]
    .sort(([a], [b]) => order(a) - order(b))
    .map(([key, label]) => ({ key, label }));
}
// Each character gets one conservative 11px slot in the 208px content width.
// Fixed columns also make wrapping and Dagre's height calculation agree.
export function categoryLines(label: string): string[] {
  const chars = Array.from(label);
  return Array.from({ length: Math.ceil(chars.length / 18) }, (_, i) =>
    chars.slice(i * 18, (i + 1) * 18).join(''),
  );
}
