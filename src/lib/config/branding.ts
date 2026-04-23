/**
 * Branding constants sourced from environment variables.
 * NEXT_PUBLIC_* variables are inlined at build time for client bundles,
 * so this module is safe to import in both Server Components and Client Components.
 */
export const APP_NAME =
  process.env.NEXT_PUBLIC_APP_NAME ?? 'Mission Control';

export const APP_DESCRIPTION =
  process.env.NEXT_PUBLIC_APP_DESCRIPTION ?? 'Agent Mission Control Dashboard';
