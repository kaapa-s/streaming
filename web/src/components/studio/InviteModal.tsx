import { useCallback, useEffect, useState } from 'react';
import {
  createRoomInvite,
  listRoomInvites,
  revokeRoomInvite,
  type RoomInviteSummary,
} from '../../lib/auth';
import { Button } from '../Button';

type InviteModalProps = {
  slug: string;
  onClose: () => void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed';
}

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

export function InviteModal({ slug, onClose }: InviteModalProps) {
  const [invites, setInvites] = useState<RoomInviteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setInvites(await listRoomInvites(slug));
      setError('');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setCreating(true);
    setError('');
    try {
      const invite = await createRoomInvite(slug);
      setCreated({ id: invite.id, url: invite.url });
      setCopied(false);
      await load();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setCreating(false);
    }
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
      setError('');
    } catch {
      setError('Could not access the clipboard. Copy the link manually.');
    }
  };

  const revoke = async (id: string) => {
    setRevokingId(id);
    setError('');
    try {
      await revokeRoomInvite(slug, id);
      if (created?.id === id) setCreated(null);
      await load();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-surface-raised p-6 shadow-lg flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="invite-title" className="text-lg font-semibold text-ink">
              Invite people
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Create a reusable link. New invitees join off-scene and wait for you to admit them.
            </p>
          </div>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>

        {created && (
          <div className="rounded-lg border border-accent/40 bg-surface p-4 flex flex-col gap-2">
            <p className="text-sm font-semibold text-ink">Invite link created</p>
            <p className="text-xs text-ink-muted">
              Copy this link now — this is the only time the full URL is shown.
            </p>
            <input
              className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent"
              type="text"
              readOnly
              value={created.url}
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="flex items-center gap-3">
              <Button variant="primary" onClick={() => void copy()}>
                {copied ? 'Copied' : 'Copy link'}
              </Button>
              {copied && <span className="text-sm text-success">Copied to clipboard</span>}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">Existing links</p>
          <Button variant="primary" loading={creating} onClick={() => void create()}>
            {creating ? 'Creating…' : 'Create invite link'}
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-ink-muted">Loading invites…</p>
        ) : invites.length === 0 ? (
          <p className="text-sm text-ink-muted">No invite links yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {invites.map((invite) => {
              const revoked = invite.revokedAt !== null;
              return (
                <li
                  key={invite.id}
                  className="rounded-lg border border-border bg-surface p-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">
                      {revoked ? 'Revoked link' : 'Active link'}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-xs text-ink-subtle">{invite.id}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">Created {formatCreatedAt(invite.createdAt)}</p>
                  </div>
                  {revoked ? (
                    <span className="shrink-0 text-xs font-semibold text-ink-subtle">Revoked</span>
                  ) : (
                    <Button
                      variant="danger"
                      loading={revokingId === invite.id}
                      onClick={() => void revoke(invite.id)}
                    >
                      Revoke
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </div>
  );
}
