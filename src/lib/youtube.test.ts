import { describe, expect, it } from 'vitest';
import { parseYouTubeUrl } from './youtube';

describe('parseYouTubeUrl', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ', 0],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc123', 'dQw4w9WgXcQ', 0],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share', 'dQw4w9WgXcQ', 0],
    ['https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ', 0],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ', 0],
    ['https://www.youtube.com/live/dQw4w9WgXcQ?feature=share', 'dQw4w9WgXcQ', 0],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ', 0],
    ['youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ', 0],
    ['dQw4w9WgXcQ', 'dQw4w9WgXcQ', 0],
    ['https://youtu.be/dQw4w9WgXcQ?t=90', 'dQw4w9WgXcQ', 90],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s', 'dQw4w9WgXcQ', 90],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1h2m3s', 'dQw4w9WgXcQ', 3723],
    ['Check this out https://youtu.be/dQw4w9WgXcQ so good', 'dQw4w9WgXcQ', 0],
  ])('reads %s', (input, videoId, start) => {
    expect(parseYouTubeUrl(input)).toEqual({ videoId, start });
  });

  it.each(['', 'hello', 'https://vimeo.com/12345', 'https://www.youtube.com/@somechannel', 'https://www.youtube.com/watch?v=short'])(
    'rejects %s',
    (input) => {
      expect(parseYouTubeUrl(input)).toBeNull();
    },
  );
});
