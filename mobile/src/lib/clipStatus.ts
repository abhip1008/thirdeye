import type { ClipStatus } from '@/types/protocol';

/**
 * How a clip status becomes something an umpire can read at arm's length.
 *
 * Pure, and separate from the component that draws it, because this mapping is
 * the load-bearing part: an umpire announces a review based on what this
 * function returns, and a clip called "Ready" that is not there is the single
 * worst outcome the product has.
 */
export type DotState = 'ready' | 'pending' | 'missing';

export const dotStateFor = (status: ClipStatus): DotState => {
  if (status === 'ready') return 'ready';
  if (status === 'failed' || status === 'expired') return 'missing';
  return 'pending';
};

export const dotLabelFor = (status: ClipStatus): string => {
  switch (status) {
    case 'ready':
      return 'Ready';
    case 'failed':
      return 'Not here';
    case 'expired':
      return 'Gone';
    case 'verifying':
      return 'Checking';
    case 'downloading':
      return 'Getting it';
    default:
      return 'Waiting';
  }
};
