import { cleanTitleText, isNoisyTitle } from './sessionText'

export function applyAutoSessionTitle(
  session: { autoTitled?: boolean; nativeTitled?: boolean; title: string },
  nativeTitle?: string,
): { title: string; nativeTitled: boolean } | null {
  if (session.autoTitled === false) return null
  const suggested = nativeTitle ? cleanTitleText(nativeTitle) : ''
  if (!suggested || isNoisyTitle(suggested)) return null
  return { title: suggested.slice(0, 80), nativeTitled: true }
}
