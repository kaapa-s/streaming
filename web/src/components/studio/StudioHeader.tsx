import type { StreamResolution } from '@streaming/stream-quality';
import { Button } from '../Button';

type StudioHeaderProps = {
  userName: string;
  resolution: StreamResolution;
  onResolutionChange: (value: StreamResolution) => void;
  rtmpUrl: string;
  onRtmpChange: (value: string) => void;
  streamControlsLocked: boolean;
  screenPending: boolean;
  screenLabel: string;
  onToggleScreenShare: () => void;
  recording: boolean;
  live: boolean;
  recordingPending: boolean;
  actionLabel: string;
  onToggleRecording: () => void;
};

export function StudioHeader({
  userName,
  resolution,
  onResolutionChange,
  rtmpUrl,
  onRtmpChange,
  streamControlsLocked,
  screenPending,
  screenLabel,
  onToggleScreenShare,
  recording,
  live,
  recordingPending,
  actionLabel,
  onToggleRecording,
}: StudioHeaderProps) {
  return (
    <header>
      <h1>Streaming Studio</h1>
      <div className="header-right">
        <span className="hint">{userName}</span>
        <select
          className="resolution-select"
          value={resolution}
          onChange={(e) => onResolutionChange(e.target.value as StreamResolution)}
          disabled={streamControlsLocked}
          title="Output resolution for recording / YouTube"
        >
          <option value="720p">720p</option>
          <option value="1080p">1080p</option>
        </select>
        <input
          className="rtmp-input"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="YouTube RTMP URL or stream key"
          value={rtmpUrl}
          onChange={(e) => onRtmpChange(e.target.value)}
          disabled={streamControlsLocked}
          title="Paste rtmp://a.rtmp.youtube.com/live2/<key> or just the stream key"
        />
        <Button type="button" loading={screenPending} onClick={onToggleScreenShare}>
          {screenLabel}
        </Button>
        {recording && <span className="rec-dot">{live ? 'LIVE' : 'REC'}</span>}
        <Button
          variant={recording ? 'danger' : 'primary'}
          loading={recordingPending}
          onClick={onToggleRecording}
        >
          {actionLabel}
        </Button>
      </div>
    </header>
  );
}
