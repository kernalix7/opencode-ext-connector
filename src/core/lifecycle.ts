export interface AsyncDisposableHandle extends AsyncDisposable {
  dispose(): Promise<void>
}

export function createAsyncDisposable(cleanup: () => void | Promise<void>): AsyncDisposableHandle {
  let disposal: Promise<void> | undefined
  const dispose = (): Promise<void> => {
    if (disposal !== undefined) {
      return disposal
    }
    const deferred = Promise.withResolvers<void>()
    disposal = deferred.promise
    Promise.resolve().then(cleanup).then(deferred.resolve, deferred.reject)
    return disposal
  }
  return {
    dispose,
    [Symbol.asyncDispose]: dispose,
  }
}
