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
  const [pullChatOnLive, setPullChatOnLive] = useState(false);
  const { pending: recordingPending, run } = useAsyncAction();

  const runRecordingAction = (action: 'start' | 'stop', opts?: { rtmpUrl?: string }) => {
    void run(async () => {
      setError('');
      try {
        const trimmed = opts?.rtmpUrl?.trim() ?? '';
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
        const nextRecording = action === 'start';
        setRecording(nextRecording);
        setLive(nextRecording ? !!body.live : false);
        if (action === 'stop') {
          setPullChatOnLive(false);
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
          setRecordingInfo(body.live ? 'Live on YouTube @ 1080p60' : 'Recording @ 1080p60');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  const startRecording = () => {
    if (recording || recordingPending) return;
    runRecordingAction('start');
  };

  const goLive = (streamKey: string, pullChat: boolean) => {
    if (recordingPending) return;
    if (recording) {
      setError('Stop recording before going live');
      return;
    }
    setPullChatOnLive(pullChat);
    runRecordingAction('start', { rtmpUrl: streamKey });
  };

  const stopRecording = () => {
    if (!recording || recordingPending) return;
    runRecordingAction('stop');
  };

  const toggleRecording = () => {
    if (recording) stopRecording();
    else startRecording();
  };

  return {
    recording,
    live,
    recordingInfo,
    finishedRecording,
    setFinishedRecording,
    rtmpUrl,
    setRtmpUrl,
    recordingPending,
    startRecording,
    goLive,
    stopRecording,
    toggleRecording,
    pullChatOnLive,
    streamControlsLocked: recording || recordingPending,
  };
}
