export const APP_UPDATE_AVAILABLE_EVENT = 'ringcode:update-available'
export const APP_UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
export const APP_UPDATE_REMIND_LATER_MS = 24 * 60 * 60 * 1000

export type AppUpdateResult = Awaited<ReturnType<NonNullable<typeof window.ringcode>['checkAppUpdate']>>

export function showAppUpdate(result: AppUpdateResult): void {
  window.dispatchEvent(new CustomEvent<AppUpdateResult>(APP_UPDATE_AVAILABLE_EVENT, { detail: result }))
}

export function shouldShowAutomaticUpdate(
  result: Pick<AppUpdateResult, 'newer' | 'latestVersion'>,
  dismissedVersion?: string,
  dismissedAt?: number,
  now = Date.now(),
): boolean {
  if (!result.newer || !result.latestVersion) return false
  if (dismissedVersion !== result.latestVersion) return true
  return !dismissedAt || now - dismissedAt >= APP_UPDATE_REMIND_LATER_MS
}
