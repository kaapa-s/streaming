import { useState } from 'react';
import { apiFetch } from '../lib/auth';
import type { FinishedRecording } from '../components/studio/RecordingFinishedModal';
import { useAsyncAction } from './useAsyncAction';
import { useLocalStorageState } from './useLocalStorageState';

const YT_RTMP_STORAGE_KEY = 'streaming-studio-yt-rtmp';

export function useRecordingControls(room: string, setError: (message: string) => void) {
  const [recording, setRecording] = useState(false);
  const [live, setLive] = useState(false);
  const [recordingInfo, setRecordingInfo] = useState('');
  const [finishedRecording, setFinishedRecording] = useState<FinishedRecording | null>(null);
  const [rtmpUrl, setRtmpUrl] = useLocalStorageState(YT_RTMP_STORAGE_KEY, '');
  const { pending: recordingPending, run } = useAsyncAction();

  const toggleRecording = () => {
    void run(async () => {
      setError('');
      try {
        const action = recording ? 'stop' : 'start';
        const trimmed = rtmpUrl.trim();
        const res = await apiFetch(`/api/recordings/${action}`, {
          method: 'POST',
          body: JSON.stringify({
            room,
            ...(action === 'start' && trimmed ? { rtmpUrl: trimmed } : {}),
          }),
        });
        const body = await res.json();
        if (!res.ok) {
          const msg = Array.isArray(body.message) ? body.message.join(', ') : body.message;
          throw new Error(msg ?? 'request failed');
        }
        const nextRecording = !recording;
        setRecording(nextRecording);
        setLive(nextRecording ? !!body.live : false);
        if (action === 'stop') {
          const downloadUrl =
            typeof body.downloadUrl === 'string' ? body.downloadUrl : undefined;
          const file = typeof body.file === 'string' ? body.file : undefined;
          if (downloadUrl || file) {
            setFinishedRecording({
              ...(downloadUrl ? { downloadUrl } : {}),
              ...(file ? { file } : {}),
            });
            setRecordingInfo(downloadUrl ? 'Recording saved' : 'Recording saved on server');
          } else {
            setFinishedRecording(null);
            setRecordingInfo('');
          }
        } else {
          setRecordingInfo(
            body.live
              ? 'Live on YouTube @ 1080p60 (also recording locally)'
              : 'Recording @ 1080p60',
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  const wantsLive = !!rtmpUrl.trim();
  const actionLabel = recordingPending
    ? recording
      ? 'Stopping…'
      : wantsLive
        ? 'Going live…'
        : 'Starting…'
    : recording
      ? live
        ? 'Stop live'
        : 'Stop recording'
      : wantsLive
        ? 'Go live'
        : 'Start recording';

  return {
    recording,
    live,
    recordingInfo,
    finishedRecording,
    setFinishedRecording,
    rtmpUrl,
    setRtmpUrl,
    recordingPending,
    toggleRecording,
    actionLabel,
    streamControlsLocked: recording || recordingPending,
  };
}
