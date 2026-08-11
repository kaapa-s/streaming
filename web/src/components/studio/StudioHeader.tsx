import { Button } from '../Button';

type StudioHeaderProps = {
  userName: string;
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
  youtubeConnected: boolean;
  youtubeAccountLabel?: string;
  youtubePending: boolean;
  onConnectYoutube: () => void;
  onDisconnectYoutube: () => void;
};

export function StudioHeader({
  userName,
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
  youtubeConnected,
  youtubeAccountLabel,
  youtubePending,
  onConnectYoutube,
  onDisconnectYoutube,
}: StudioHeaderProps) {
  return (
    <header>
      <h1>Streaming Studio</h1>
      <div className="header-right">
        <span className="hint">{userName}</span>
        <span className="hint">1080p60</span>
        {youtubeConnected ? (
          <Button type="button" loading={youtubePending} onClick={onDisconnectYoutube}>
            {youtubeAccountLabel ? `YT: ${youtubeAccountLabel}` : 'Disconnect YT'}
          </Button>
        ) : (
          <Button type="button" loading={youtubePending} onClick={onConnectYoutube}>
            Connect YouTube
          </Button>
        )}
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
