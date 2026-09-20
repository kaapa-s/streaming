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

export function useRecordingControls(
  room: string,
  setError: (message: string) => void,
  options: { joined?: boolean; isOwner?: boolean } = {},
) {
  const { joined = false, isOwner = false } = options;
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

  /**
   * Durable room state, not this browser tab, owns the media session. On
   * (re)join the owner restores the active session so the Stop control and live
   * comments reappear without a second start request.
   */
  useEffect(() => {
    if (!joined || !isOwner) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch(`/api/recordings/session?room=${encodeURIComponent(room)}`);
        if (!res.ok) return;
        const body = await res.json();
        if (cancelled) return;
        if (body.active) {
          const nextDestinations = Array.isArray(body.destinations)
            ? (body.destinations as PlatformProvider[])
            : [];
          setRecording(true);
          setLive(!!body.live);
          setLiveDestinations(nextDestinations);
          setRecordingInfo(
            body.live ? formatLiveInfo(nextDestinations) : 'Streaming privately @ 1080p60',
          );
        } else if (body.status === 'stopping' || body.status === 'uploading') {
          setRecording(false);
          setLive(false);
          setLiveDestinations([]);
          setRecordingInfo('Finalizing stream…');
        }
      } catch {
        // Restoring control is best-effort; a failed lookup must not block the studio.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [room, joined, isOwner]);

  const runRecordingAction = (
    action: 'start' | 'stop',
    opts?: { destinations?: OutboundDestination[] },
  ) => {
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
          if (body.status === 'failed') {
            // Finalization failed after the media session ended. Surface it and do
            // not present a saved recording that does not exist.
            setFinishedRecording(null);
            setRecordingInfo('');
            setError(
              typeof body.error === 'string' && body.error.trim()
                ? body.error
                : 'Stream processing failed',
            );
          } else if (downloadUrl || file) {
            setFinishedRecording({
              ...(downloadUrl ? { downloadUrl } : {}),
              ...(file ? { file } : {}),
            });
            setRecordingInfo(downloadUrl ? 'Stream saved' : 'Stream saved on server');
          } else {
            setFinishedRecording(null);
            setRecordingInfo('');
          }
        } else {
          setRecordingInfo(
            body.live ? formatLiveInfo(nextDestinations) : 'Streaming privately @ 1080p60',
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  const stopRecording = () => {
    if (!recording || recordingPending) return;
    runRecordingAction('stop');
  };

  /**
   * Single entry point for both private and simulcast streams. Destinations are
   * optional: an empty list starts a private stream that is saved on the server.
   */
  const startStream = (destinations: OutboundDestination[] = []) => {
    if (recording || recordingPending) return;
    for (const dest of destinations) {
      setStreamKey(dest.platform, dest.streamKey);
    }
    runRecordingAction('start', { destinations });
  };

  const toggleRecording = () => {
    if (recording) stopRecording();
    else startStream();
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
    startStream,
    stopRecording,
    toggleRecording,
    resetUi,
    streamControlsLocked: recording || recordingPending,
  };
}
