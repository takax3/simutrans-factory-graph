import { useState } from 'react';
import { Factory } from 'lucide-react';
import type { PreviewImage } from './types';

export default function IndustryImage({
  image,
  name,
  detail = false,
}: {
  image?: PreviewImage;
  name: string;
  detail?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={'industry-image ' + (detail ? 'industry-image-detail' : '')}>
      {image && !failed ? (
        <img src={image.data_url} alt={`${name}の建物画像`} onError={() => setFailed(true)} />
      ) : (
        <span className="industry-image-fallback">
          <Factory size={detail ? 28 : 22} />
          {detail && '画像なし'}
        </span>
      )}
    </div>
  );
}
