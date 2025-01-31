import type { File, Suite, TaskBase } from '../types/tasks'
import { processError } from '@vitest/utils/error'
import { relative } from 'pathe'

/**
 * If any tasks been marked as `only`, mark all other tasks as `skip`.
 */
export function interpretTaskModes(
  file: Suite,
  namePattern?: string | RegExp,
  testLocations?: number[] | undefined,
  onlyMode?: boolean,
  parentIsOnly?: boolean,
  allowOnly?: boolean,
): void {
  const matchedLocations: number[] = []

  const traverseSuite = (suite: Suite, parentIsOnly?: boolean) => {
    const suiteIsOnly = parentIsOnly || suite.mode === 'only'

    suite.tasks.forEach((t) => {
      // Check if either the parent suite or the task itself are marked as included
      const includeTask = suiteIsOnly || t.mode === 'only'
      if (onlyMode) {
        if (t.type === 'suite' && (includeTask || someTasksAreOnly(t))) {
          // Don't skip this suite
          if (t.mode === 'only') {
            checkAllowOnly(t, allowOnly)
            t.mode = 'run'
          }
        }
        else if (t.mode === 'run' && !includeTask) {
          t.mode = 'skip'
        }
        else if (t.mode === 'only') {
          checkAllowOnly(t, allowOnly)
          t.mode = 'run'
        }
      }
      if (t.type === 'test') {
        if (namePattern && !getTaskFullName(t).match(namePattern)) {
          t.mode = 'skip'
        }

        // Match test location against provided locations, only run if present
        // in `testLocations`.  Note: if `includeTaskLocations` is not enabled,
        // all test will be skipped.
        if (testLocations !== undefined && testLocations.length !== 0) {
          if (t.location && testLocations?.includes(t.location.line)) {
            t.mode = 'run'
            matchedLocations.push(t.location.line)
          }
          else {
            t.mode = 'skip'
          }
        }
      }
      else if (t.type === 'suite') {
        if (t.mode === 'skip') {
          skipAllTasks(t)
        }
        else {
          traverseSuite(t, includeTask)
        }
      }
    })

    // if all subtasks are skipped, mark as skip
    if (suite.mode === 'run') {
      if (suite.tasks.length && suite.tasks.every(i => i.mode !== 'run')) {
        suite.mode = 'skip'
      }
    }
  }

  traverseSuite(file, parentIsOnly)

  const nonMatching = testLocations?.filter(loc => !matchedLocations.includes(loc))
  if (nonMatching && nonMatching.length !== 0) {
    const message = nonMatching.length === 1
      ? `line ${nonMatching[0]}`
      : `lines ${nonMatching.join(', ')}`

    if (file.result === undefined) {
      file.result = {
        state: 'fail',
        errors: [],
      }
    }
    if (file.result.errors === undefined) {
      file.result.errors = []
    }

    file.result.errors.push(
      processError(new Error(`No test found in ${file.name} in ${message}`)),
    )
  }
}

function getTaskFullName(task: TaskBase): string {
  return `${task.suite ? `${getTaskFullName(task.suite)} ` : ''}${task.name}`
}

export function someTasksAreOnly(suite: Suite): boolean {
  return suite.tasks.some(
    t => t.mode === 'only' || (t.type === 'suite' && someTasksAreOnly(t)),
  )
}

function skipAllTasks(suite: Suite) {
  suite.tasks.forEach((t) => {
    if (t.mode === 'run') {
      t.mode = 'skip'
      if (t.type === 'suite') {
        skipAllTasks(t)
      }
    }
  })
}

function checkAllowOnly(task: TaskBase, allowOnly?: boolean) {
  if (allowOnly) {
    return
  }
  const error = processError(
    new Error(
      '[Vitest] Unexpected .only modifier. Remove it or pass --allowOnly argument to bypass this error',
    ),
  )
  task.result = {
    state: 'fail',
    errors: [error],
  }
}

export function generateHash(str: string): string {
  let hash = 0
  if (str.length === 0) {
    return `${hash}`
  }
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32bit integer
  }
  return `${hash}`
}

export function calculateSuiteHash(parent: Suite): void {
  parent.tasks.forEach((t, idx) => {
    t.id = `${parent.id}_${idx}`
    if (t.type === 'suite') {
      calculateSuiteHash(t)
    }
  })
}

export function createFileTask(
  filepath: string,
  root: string,
  projectName: string | undefined,
  pool?: string,
): File {
  const path = relative(root, filepath)
  const file: File = {
    id: generateHash(`${path}${projectName || ''}`),
    name: path,
    type: 'suite',
    mode: 'run',
    filepath,
    tasks: [],
    meta: Object.create(null),
    projectName,
    file: undefined!,
    pool,
  }
  file.file = file
  return file
}
