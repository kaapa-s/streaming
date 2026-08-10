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
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="finished-recording-title"
      onClick={onClose}
    >
      <div
        className="modal"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <h2 id="finished-recording-title">Recording finished</h2>
        {recording.downloadUrl ? (
          <p>Your stream has been uploaded and is ready to download.</p>
        ) : (
          <p>
            Your recording was saved on the server
            {recording.file ? ` (${recording.file})` : ''}. Download is only available when cloud
            upload is configured.
          </p>
        )}
        <div className="modal-actions">
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
