import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCaptureSession } from '../useCaptureSession';
import { ServicesProvider } from '../../../context/ServicesProvider';
import { ICaptureService } from '../../../shared/interfaces/ICaptureService';
import { IEventBus, ProviderStatus } from '../../../shared/interfaces/IEventBus';

/**
 * A fake wide enough to satisfy IEventBus's ~20 methods (see the SOLID audit's
 * ISP note on that interface) without implementing all of them — every method
 * this hook does not use is a no-op, and the two it does use are wired to
 * fire on demand from the test.
 */
function createFakeEventBus(overrides: Partial<IEventBus> = {}): IEventBus {
  const noop = () => () => {};
  return new Proxy({} as IEventBus, {
    get(target, prop) {
      const overridesRecord = overrides as unknown as Record<string | symbol, unknown>;
      if (prop in overridesRecord) return overridesRecord[prop];
      if (prop in target) return (target as unknown as Record<string | symbol, unknown>)[prop];
      return noop;
    },
  });
}

function createFakeCaptureService(overrides: Partial<ICaptureService> = {}): ICaptureService {
  return {
    startCapture: vi.fn().mockResolvedValue(42),
    stopCapture: vi.fn().mockResolvedValue(undefined),
    checkBlackholeInstalled: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function renderWithServices(captureService: ICaptureService, eventBus: IEventBus) {
  return renderHook(() => useCaptureSession(), {
    wrapper: ({ children }) =>
      React.createElement(ServicesProvider, { services: { captureService, eventBus }, children }),
  });
}

describe('useCaptureSession', () => {
  it('starts idle, then live once provider_status reports active', async () => {
    let statusCb: ((status: ProviderStatus) => void) | undefined;
    const eventBus = createFakeEventBus({
      onProviderStatus: (cb) => {
        statusCb = cb;
        return () => {};
      },
    });
    const captureService = createFakeCaptureService();

    const { result } = renderWithServices(captureService, eventBus);
    expect(result.current.status).toBe('idle');

    await act(async () => {
      await result.current.startCapture();
    });
    expect(captureService.startCapture).toHaveBeenCalledTimes(1);
    expect(result.current.sessionId).toBe(42);

    // The gateway emits 'active', not 'live' — toSessionStatus's job is to
    // translate that, and this is the regression it was written to guard.
    act(() => statusCb?.({ provider: 'assemblyai', state: 'active' }));
    await waitFor(() => expect(result.current.status).toBe('live'));
    expect(result.current.provider).toBe('assemblyai');
  });

  it('does not start a session when BlackHole is missing', async () => {
    const captureService = createFakeCaptureService({
      checkBlackholeInstalled: vi.fn().mockResolvedValue(false),
    });
    const eventBus = createFakeEventBus();

    const { result } = renderWithServices(captureService, eventBus);
    await waitFor(() => expect(result.current.blackholeMissing).toBe(true));

    await act(async () => {
      await result.current.startCapture();
    });
    expect(captureService.startCapture).not.toHaveBeenCalled();
  });

  it('returns to idle with the reason visible when starting fails', async () => {
    const captureService = createFakeCaptureService({
      startCapture: vi.fn().mockRejectedValue(new Error('sidecar unreachable')),
    });
    const eventBus = createFakeEventBus();

    const { result } = renderWithServices(captureService, eventBus);
    await act(async () => {
      await result.current.startCapture();
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.sessionId).toBeNull();
    expect(result.current.lastError).toBe('sidecar unreachable');
  });

  it('on a capture_error event, stops the session and clears it back to idle', async () => {
    let errorCb: ((err: string) => void) | undefined;
    const captureService = createFakeCaptureService();
    const eventBus = createFakeEventBus({
      onCaptureError: (cb) => {
        errorCb = cb;
        return () => {};
      },
    });

    const { result } = renderWithServices(captureService, eventBus);
    await act(async () => {
      await result.current.startCapture();
    });

    act(() => errorCb?.('provider crashed'));
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(result.current.lastError).toBe('provider crashed');
    expect(result.current.sessionId).toBeNull();
    expect(captureService.stopCapture).toHaveBeenCalled();
  });

  it('stopCapture always returns to idle, even when the service call rejects', async () => {
    const captureService = createFakeCaptureService({
      stopCapture: vi.fn().mockRejectedValue(new Error('already gone')),
    });
    const eventBus = createFakeEventBus();

    const { result } = renderWithServices(captureService, eventBus);
    await act(async () => {
      await result.current.stopCapture();
    });

    expect(result.current.isStopping).toBe(false);
    expect(result.current.status).toBe('idle');
    expect(result.current.sessionId).toBeNull();
  });
});

describe('useCaptureSession trial', () => {
  it('returns to idle without an error when the trial ends mid-capture', async () => {
    let statusCb: ((status: ProviderStatus) => void) | undefined;
    let trialEnded: (() => void) | undefined;
    const eventBus = createFakeEventBus({
      onProviderStatus: (cb) => {
        statusCb = cb;
        return () => {};
      },
      onTrialEnded: (cb) => {
        trialEnded = () => cb({ plan: 'free', unlimited: false, admin: false, limitSeconds: 300, usedSeconds: 300, remainingSeconds: 0 });
        return () => {};
      },
    });
    const { result } = renderWithServices(createFakeCaptureService(), eventBus);

    await act(async () => {
      await result.current.startCapture();
    });
    act(() => statusCb?.({ provider: 'assemblyai', state: 'active' }));
    await waitFor(() => expect(result.current.status).toBe('live'));

    act(() => trialEnded?.());
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(result.current.sessionId).toBeNull();
    expect(result.current.lastError).toBeNull();
  });
});
