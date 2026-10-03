import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import IndustryImage from './IndustryImage';
afterEach(cleanup);
it('renders the cached image and falls back when image loading fails', () => {
  render(
    <IndustryImage
      name="食品工場"
      detail
      image={{ data_url: 'data:image/png;base64,test', width: 32, height: 16 }}
    />,
  );
  const image = screen.getByRole('img', { name: '食品工場の建物画像' });
  expect(image).toHaveAttribute('src', 'data:image/png;base64,test');
  fireEvent.error(image);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.getByText('画像なし')).toBeInTheDocument();
});
it('uses an icon for nodes and a label for details with no image', () => {
  const { rerender } = render(<IndustryImage name="食品工場" />);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.queryByText('画像なし')).not.toBeInTheDocument();
  rerender(<IndustryImage name="食品工場" detail />);
  expect(screen.getByText('画像なし')).toBeInTheDocument();
});
