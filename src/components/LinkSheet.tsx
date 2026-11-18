import { useEffect, useRef, useState } from 'react';
import { listRecents } from '../lib/recents';
import { cx } from '../lib/ui';
import { thumbnailUrl } from '../lib/videoInfo';
import { parseYouTubeUrl, type ParsedVideo } from '../lib/youtube';
import { Icon } from './Icon';

const CLOSE_MS = 180;

interface LinkSheetProps {
  onPick(video: ParsedVideo): void;
  onClose(): void;
}

/**
 * Where a video is chosen: paste a link, or pick something watched before.
 * Drops down from the top so the phone keyboard never covers it.
 */
export function LinkSheet({ onPick, onClose }: LinkSheetProps) {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [recents] = useState(listRecents);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const canReadClipboard = typeof navigator.clipboard?.readText === 'function';

  const close = () => setClosing(true);
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(onClose, CLOSE_MS);
    return () => clearTimeout(timer);
  }, [closing, onClose]);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setClosing(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const submit = (raw: string) => {
    const video = parseYouTubeUrl(raw);
    if (!video) {
      setProblem('That doesn’t look like a YouTube link.');
      return;
    }
    onPick(video);
  };

  const pasteFromClipboard = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (parseYouTubeUrl(clip)) submit(clip);
      else setProblem('There’s no YouTube link on your clipboard. Copy one in YouTube with Share, then Copy link.');
    } catch {
      inputRef.current?.focus(); // permission refused: let them paste by hand
    }
  };

  return (
    <div className={cx('sheet-layer', closing && 'closing')}>
      <button type="button" className="sheet-backdrop" onClick={close} aria-label="Close" tabIndex={-1} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Pick a video" ref={panelRef} tabIndex={-1}>
        <div className="sheet-head">
          <h2>Pick a video</h2>
          <button type="button" className="icon-btn" onClick={close} aria-label="Close">
            <Icon name="close" size={20} weight="bold" />
          </button>
        </div>

        <form
          className="link-form"
          onSubmit={(event) => {
            event.preventDefault();
            submit(text);
          }}
        >
          <input
            ref={inputRef}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setProblem(null);
            }}
            onPaste={(event) => {
              // Pasting a link is the whole gesture; no need to also press a button.
              const pasted = event.clipboardData.getData('text');
              if (parseYouTubeUrl(pasted)) {
                event.preventDefault();
                submit(pasted);
              }
            }}
            placeholder="Paste a YouTube link"
            aria-label="YouTube link"
            inputMode="url"
            enterKeyHint="go"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
          />
          {text.trim() === '' && canReadClipboard ? (
            <button type="button" className="btn primary" onClick={pasteFromClipboard}>
              <Icon name="paste" size={19} weight="bold" />
              Paste
            </button>
          ) : (
            <button type="submit" className="btn primary" disabled={text.trim() === ''}>
              Watch
            </button>
          )}
        </form>
        {problem && (
          <p className="sheet-problem" role="alert">
            {problem}
          </p>
        )}

        {recents.length > 0 ? (
          <>
            <h3>Watched before</h3>
            <ul className="recents">
              {recents.map((recent) => (
                <li key={recent.videoId}>
                  <button type="button" onClick={() => onPick({ videoId: recent.videoId, start: 0 })}>
                    <img src={thumbnailUrl(recent.videoId)} alt="" loading="lazy" width="96" height="54" />
                    <span className="recent-text">
                      <strong>{recent.title}</strong>
                      <span>{recent.author}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="sheet-tip">
            In YouTube, tap Share, then Copy link, and paste it here. It loads for both of you, paused, ready to start together.
          </p>
        )}
      </div>
    </div>
  );
}
