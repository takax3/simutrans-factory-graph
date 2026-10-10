import { describe, it, expect } from 'vitest';
import { categoryLabel, categoryKey, categoryLines } from './categories';
import { goods } from './fixtures';
describe('category labels', () => {
  it('distinguishes missing data, dedicated cargo and missing translations', () => {
    const good = goods('cargo');
    expect(categoryKey(good)).toBe('unknown');
    expect(categoryLabel(good)).toBe('カテゴリ不明');
    good.category_id = 0;
    expect(categoryLabel(good)).toBe('専用貨物');
    good.category_id = 255;
    expect(categoryLabel(good)).toBe('カテゴリ 255');
    good.category_name = 'パレット貨物';
    expect(categoryLabel(good)).toBe('パレット貨物');
  });
  it('wraps long labels without dropping characters, including emoji', () => {
    const label = '非常に長いカテゴリ名とパレット貨物の名称'.repeat(4) + '🚂';
    expect(categoryLines(label).join('')).toBe(label);
    expect(categoryLines(label).every((line) => Array.from(line).length <= 18)).toBe(true);
  });
});
