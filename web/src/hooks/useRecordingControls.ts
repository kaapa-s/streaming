import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/auth';
import type { FinishedRecording } from '../components/studio/RecordingFinishedModal';
import {
  STREAM_KEY_STORAGE,
  formatLiveInfo,
  type OutboundDestination,
  type PlatformProvider,
} from '../lib/platforms';
import { useAsyncAction } from './useAsyncAction';
import { useLocalStorageState } from './useLocalStorageState';

export function useRecordingControls(room: string | null, setError: (message: string) => void) {
  const [recording, setRecording] = useState(false);
  const [live, setLive] = useState(false);
  const [liveDestinations, setLiveDestinations] = useState<PlatformProvider[]>([]);
  const [recordingInfo, setRecordingInfo] = useState('');
  const [finishedRecording, setFinishedRecording] = useState<FinishedRecording | null>(null);
  const [youtubeKey, setYoutubeKey] = useLocalStorageState(STREAM_KEY_STORAGE.youtube, '');
  const [facebookKey, setFacebookKey] = useLocalStorageState(STREAM_KEY_STORAGE.facebook, '');
  const [linkedinKey, setLinkedinKey] = useLocalStorageState(STREAM_KEY_STORAGE.linkedin, '');
  const [instagramKey, setInstagramKey] = useLocalStorageState(STREAM_KEY_STORAGE.instagram, '');
  const [xKey, setXKey] = useLocalStorageState(STREAM_KEY_STORAGE.x, '');
  const { pending: recordingPending, run } = useAsyncAction();

  const streamKeys: Record<PlatformProvider, string> = {
    youtube: youtubeKey,
    facebook: facebookKey,
    linkedin: linkedinKey,
    instagram: instagramKey,
    x: xKey,
  };

  const setStreamKey = (platform: PlatformProvider, value: string) => {
    switch (platform) {
      case 'youtube':
        setYoutubeKey(value);
        break;
      case 'facebook':
        setFacebookKey(value);
        break;
      case 'linkedin':
        setLinkedinKey(value);
        break;
      case 'instagram':
        setInstagramKey(value);
        break;
      case 'x':
        setXKey(value);
        break;
    }
  };

  const resetUi = () => {
    setRecording(false);
    setLive(false);
    setLiveDestinations([]);
    setRecordingInfo('');
  };

  useEffect(() => {
    resetUi();
  }, [room]);

  const runRecordingAction = (
    action: 'start' | 'stop',
    opts?: { destinations?: OutboundDestination[] },
  ) => {
    if (!room) return;
    void run(async () => {
      setError('');
      try {
        const destinations = opts?.destinations ?? [];
        const res = await apiFetch(`/api/recordings/${action}`, {
          method: 'POST',
          body: JSON.stringify({
            room,
            ...(action === 'start' && destinations.length ? { destinations } : {}),
          }),
        });
        const body = await res.json();
        if (!res.ok) {
          const msg = Array.isArray(body.message) ? body.message.join(', ') : body.message;
          throw new Error(msg ?? 'request failed');
        }
        const nextRecording = action === 'start';
        setRecording(nextRecording);
        const nextLive = nextRecording ? !!body.live : false;
        setLive(nextLive);
        const nextDestinations = Array.isArray(body.destinations)
          ? (body.destinations as PlatformProvider[])
          : destinations.map((d) => d.platform);
        setLiveDestinations(nextRecording && nextLive ? nextDestinations : []);
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
            body.live ? formatLiveInfo(nextDestinations) : 'Recording @ 1080p60',
          );
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

  const goLive = (destinations: OutboundDestination[]) => {
    if (recordingPending) return;
    if (recording) {
      setError('Stop recording before going live');
      return;
    }
    for (const dest of destinations) {
      setStreamKey(dest.platform, dest.streamKey);
    }
    runRecordingAction('start', { destinations });
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
    liveDestinations,
    recordingInfo,
    finishedRecording,
    setFinishedRecording,
    streamKeys,
    setStreamKey,
    recordingPending,
    startRecording,
    goLive,
    stopRecording,
    toggleRecording,
    resetUi,
    streamControlsLocked: recording || recordingPending,
  };
}
