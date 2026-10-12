import "@testing-library/jest-dom/vitest";

// jsdom has no media playback and logs "Not implemented" for every call, which
// buries real failures under the MotionClip on the sign-in and start screens.
Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, writable: true, value: () => Promise.resolve() });
Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, writable: true, value: () => {} });
