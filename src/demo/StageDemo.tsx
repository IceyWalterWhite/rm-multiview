import { useCallback, useState } from 'react';
import { LiveStage } from '../components/LiveStage';
import { DEFAULT_MAIN_QUALITY, DEFAULT_MULTI_QUALITY, type QualityLabel } from '../config';
import type { Profile } from '../types';
import { demoCatalog } from './demoData';

/**
 * 仅开发期：用假名单驱动完整舞台，在没有直播的时候也能调布局。
 *
 * 挂在 `?stagedemo` 下，且 `main.tsx` 里由 `import.meta.env.DEV` 守卫 ——
 * 生产构建整支被 DCE，不进任何 bundle。
 *
 * 十路都是 `demo:` 源，`VideoPlayer` 会渲染占位色块而不发一个请求，
 * 所以拖分隔条、量排布、试重排都不需要真实直播（也不吃带宽）。
 * 但**看不出真实画面下的观感**，最终仍要在有直播时复验一次。
 */
const DEMO_PROFILE: Profile = {
  nickname: '观众甲',
  schoolName: '演示大学',
  position: '队员',
  racingAge: 3,
  badge: '',
};

export default function StageDemo() {
  const [mainQuality, setMainQuality] = useState<QualityLabel>(DEFAULT_MAIN_QUALITY);
  const [multiQuality, setMultiQuality] = useState<QualityLabel>(DEFAULT_MULTI_QUALITY);
  const noop = useCallback(() => {}, []);
  return (
    <div className="app">
      <LiveStage
        catalog={demoCatalog}
        messages={[]}
        danmakuEnabled
        mainQuality={mainQuality}
        multiQuality={multiQuality}
        setMainQuality={setMainQuality}
        setMultiQuality={setMultiQuality}
        profile={DEMO_PROFILE}
        isComplete
        onSend={noop}
        onEditIdentity={noop}
      />
    </div>
  );
}
