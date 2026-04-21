import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge Tailwind classes cleanly, de-duping conflicts. */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
