import { Button } from '../Button';

export type FinishedRecording = {
  downloadUrl?: string;
  file?: string;
};

type RecordingFinishedModalProps = {
  recording: FinishedRecording;
  onClose: () => void;
};

export function RecordingFinishedModal({ recording, onClose }: RecordingFinishedModalProps) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="finished-recording-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-border bg-surface-raised p-6 flex flex-col gap-3 shadow-lg"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <h2 id="finished-recording-title" className="m-0 text-xl font-bold text-ink">
          Recording finished
        </h2>
        {recording.downloadUrl ? (
          <p className="m-0 text-sm text-ink-muted leading-relaxed">
            Your stream has been uploaded and is ready to download.
          </p>
        ) : (
          <p className="m-0 text-sm text-ink-muted leading-relaxed">
            Your recording was saved on the server
            {recording.file ? ` (${recording.file})` : ''}. Download is only available when cloud
            upload is configured.
          </p>
        )}
        <div className="flex gap-2.5 mt-2 flex-wrap">
          {recording.downloadUrl && (
            <Button
              variant="primary"
              onClick={() => {
                const url = recording.downloadUrl;
                if (!url) return;
                const a = document.createElement('a');
                a.href = url;
                a.download = '';
                a.rel = 'noopener';
                a.target = '_blank';
                a.click();
              }}
            >
              Download
            </Button>
          )}
          <Button type="button" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
