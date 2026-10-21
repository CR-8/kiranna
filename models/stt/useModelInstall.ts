import { useCallback, useEffect, useRef, useState } from 'react';

import { ModelInstallError, type InstallProgress } from './modelManager';
import { totalDownloadBytes } from './modelSpec';
import { getSharedSttProvider } from './shared';

export type ModelInstallState =
  | { status: 'checking' }
  | { status: 'not_installed'; downloadBytes: number }
  | { status: 'installing'; progress: InstallProgress | null }
  | { status: 'installed' }
  | { status: 'failed'; error: ModelInstallError; downloadBytes: number };

/** Drives an explicit, user-initiated model download. Nothing is downloaded until `install()` is called. */
export function useModelInstall(manager = getSharedSttProvider().manager) {
  const downloadBytes = totalDownloadBytes(manager.spec);
  const [state, setState] = useState<ModelInstallState>({ status: 'checking' });
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    setState(manager.isInstalled() ? { status: 'installed' } : { status: 'not_installed', downloadBytes });
    return () => abort.current?.abort();
  }, [manager, downloadBytes]);

  const install = useCallback(async () => {
    const controller = new AbortController();
    abort.current = controller;
    setState({ status: 'installing', progress: null });
    try {
      await manager.install({
        signal: controller.signal,
        onProgress: (progress) => setState({ status: 'installing', progress }),
      });
      setState({ status: 'installed' });
    } catch (e) {
      const error = e instanceof ModelInstallError ? e : new ModelInstallError('FILESYSTEM', String(e), e);
      setState(
        error.code === 'CANCELLED'
          ? { status: 'not_installed', downloadBytes }
          : { status: 'failed', error, downloadBytes },
      );
    } finally {
      abort.current = null;
    }
  }, [manager, downloadBytes]);

  const cancel = useCallback(() => abort.current?.abort(), []);

  const uninstall = useCallback(async () => {
    await getSharedSttProvider().release();
    await manager.uninstall();
    setState({ status: 'not_installed', downloadBytes });
  }, [manager, downloadBytes]);

  return { state, install, cancel, uninstall };
}
