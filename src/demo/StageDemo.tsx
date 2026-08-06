import { useCallback, useEffect, useState } from 'react';
import { CheerBar } from '../components/CheerBar';
import { LiveStage } from '../components/LiveStage';
import { WatchTaskCapsule } from '../components/WatchTaskCapsule';
import {
  companionScriptUrlFor,
  DEFAULT_MAIN_QUALITY,
  DEFAULT_MULTI_QUALITY,
  RM_OFFICIAL_LIVE_URL,
  type QualityLabel,
} from '../config';
import type { OfficialBridgeStatus } from '../net/officialBridge';
import type { Profile } from '../types';
import { demoCatalog, demoCheer, demoWatchTiers } from './demoData';

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

const BRIDGE_STATES: OfficialBridgeStatus[] = ['probing', 'missing', 'ready', 'error'];

/** `?stagedemo&bridge=missing&login=0` —— 桥接控件的四种状态都得能单独看一眼 */
function queryBridge(): OfficialBridgeStatus {
  const v = new URLSearchParams(location.search).get('bridge') as OfficialBridgeStatus | null;
  return v && BRIDGE_STATES.includes(v) ? v : 'ready';
}

export default function StageDemo() {
  const [mainQuality, setMainQuality] = useState<QualityLabel>(DEFAULT_MAIN_QUALITY);
  const [multiQuality, setMultiQuality] = useState<QualityLabel>(DEFAULT_MULTI_QUALITY);
  const [votes, setVotes] = useState(() => ({ red: demoCheer.baseRed, blue: demoCheer.baseBlue }));
  const noop = useCallback(() => {}, []);

  const bridgeStatus = queryBridge();
  const loggedIn = new URLSearchParams(location.search).get('login') !== '0';

  // 假的对方在涨票，好看清追平/反超时中缝的动静
  useEffect(() => {
    const id = setInterval(() => setVotes((v) => ({ red: v.red + 8, blue: v.blue + 5 })), 3000);
    return () => clearInterval(id);
  }, []);
  // 本地乐观加票：只验手感，不出网（真实投票走 useCheer 的批量 flush）
  const vote = useCallback((side: 'red' | 'blue') => {
    setVotes((v) => ({ ...v, [side]: v[side] + 1 }));
  }, []);

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
        cheerSlot={(
          <CheerBar
            redVotes={votes.red}
            blueVotes={votes.blue}
            redLabel={demoCheer.redLabel}
            blueLabel={demoCheer.blueLabel}
            canVote
            onVote={vote}
            officialUrl={demoCheer.officialUrl}
          />
        )}
        watchTaskSlot={(
          <WatchTaskCapsule
            loggedIn={loggedIn}
            accumulatedSeconds={512}
            earnedPellets={500}
            tiers={demoWatchTiers}
            loginUrl={`${RM_OFFICIAL_LIVE_URL}#demo-login`}
            officialUrl={RM_OFFICIAL_LIVE_URL}
            installUrl={companionScriptUrlFor(location.hostname)}
            bridgeStatus={bridgeStatus}
            heartbeatStatus={loggedIn && bridgeStatus === 'ready' ? 'running' : 'idle'}
            heartbeatError={null}
            onRetryHeartbeat={noop}
          />
        )}
      />
    </div>
  );
}
