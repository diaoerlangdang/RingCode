import { runCloneLaunch } from './cloneLaunchRun'

const cloneId = process.argv[2] ?? ''
const rest = process.argv.slice(3)

void runCloneLaunch(cloneId, rest)
  .then((code) => {
    process.exit(code)
  })
  .catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  })
