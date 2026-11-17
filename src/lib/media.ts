export interface LocalMedia {
  stream: MediaStream | null;
  /** Set when we could not get everything; the user can still join and watch. */
  problem: string | null;
}

const AUDIO: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
// A small picture is plenty for a side tile and leaves bandwidth for YouTube.
const VIDEO: MediaTrackConstraints = {
  facingMode: 'user',
  width: { ideal: 640 },
  height: { ideal: 480 },
  frameRate: { ideal: 24, max: 30 },
};

export async function getLocalMedia(): Promise<LocalMedia> {
  const devices = navigator.mediaDevices;
  if (!devices?.getUserMedia) {
    return { stream: null, problem: 'This browser can’t use the camera or microphone here (the page must be opened over https).' };
  }
  try {
    return { stream: await devices.getUserMedia({ audio: AUDIO, video: VIDEO }), problem: null };
  } catch (err) {
    const denied = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    if (!denied) {
      // No camera, or it's in use: a voice-only call still beats nothing.
      try {
        return {
          stream: await devices.getUserMedia({ audio: AUDIO }),
          problem: 'No camera available, so you joined with your microphone only.',
        };
      } catch {
        // fall through
      }
    }
    return {
      stream: null,
      problem: denied
        ? 'Camera and microphone are blocked for this site, so you can watch and listen but not be seen or heard. Allow them in your browser settings and rejoin.'
        : 'No camera or microphone was found, so you can watch and listen but not be seen or heard.',
    };
  }
}

export function stopMedia(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}
