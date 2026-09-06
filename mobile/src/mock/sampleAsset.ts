import type { VideoSource } from 'expo-video';

import { MOCK_CLIP_PATH } from './sampleClip';

const bundled = require('../../assets/mock/sample.mp4') as number;

/**
 * Turns a stored `local_path` into something the player can open.
 *
 * Real clips are `file://` URIs and pass straight through; the mock sentinel
 * resolves to the bundled sample. This is the only module that touches the
 * binary, so nothing else has to care that it exists.
 */
export function resolveVideoSource(localPath: string | null): VideoSource {
  if (!localPath) return null;
  return localPath === MOCK_CLIP_PATH ? bundled : { uri: localPath };
}
