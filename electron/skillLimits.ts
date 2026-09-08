export const MAX_SKILL_IMPORT_BYTES = 50 * 1024 * 1024

export function assertSkillImportSize(totalBytes: number): void {
  if (!Number.isFinite(totalBytes) || totalBytes > MAX_SKILL_IMPORT_BYTES) {
    throw new Error('Skill 过大：导入体积超过 50MB')
  }
}
