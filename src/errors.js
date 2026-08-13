export const ErrAuth = 'auth';
export const ErrQuota = 'quota';
export const ErrTimeout = 'timeout';
export const ErrNetwork = 'network';
export const ErrTaskFailed = 'task_failed';
export const ErrGeneral = 'general';

export class SeaArtError extends Error {
  constructor({ kind = ErrGeneral, message = 'SeaArt SDK error', status = 0, taskID = '', code = undefined } = {}) {
    super(taskID ? `${message} (task_id: ${taskID})` : message);
    this.name = 'SeaArtError';
    this.kind = kind;
    this.status = status;
    this.taskID = taskID;
    this.code = code;
    this.Kind = kind;
    this.Status = status;
    this.TaskID = taskID;
  }
}

export function newHTTPError(status, message) {
  let kind = ErrGeneral;
  if (status === 401 || status === 403) {
    kind = ErrAuth;
  } else if (status === 429) {
    kind = ErrQuota;
  } else if (status === 408 || status === 504) {
    kind = ErrTimeout;
  }
  return new SeaArtError({ kind, status, message });
}

export function withTaskID(error, taskID) {
  if (error instanceof SeaArtError) {
    error.taskID = taskID;
    error.TaskID = taskID;
    error.message = taskID ? `${stripTaskID(error.message)} (task_id: ${taskID})` : stripTaskID(error.message);
  }
  return error;
}

function stripTaskID(message) {
  return String(message).replace(/\s+\(task_id: .*?\)$/, '');
}
