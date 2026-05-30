import { useEffect, useMemo, useState } from 'react';
import { HOST_DISPLAY_PATH } from '@shared/constants';
import { DEFAULT_HOST_CSS_PX_PER_INCH } from '../constants';
import type { Size } from '../utils/resolution';

type HostDisplay = {
  name?: string;
  widthMm: number;
  heightMm: number;
  nativeWidth?: number;
  nativeHeight?: number;
};

declare global {
  interface Window {
    __SCRY_HOST_DISPLAYS__?: HostDisplay[];
  }
}

function getBootstrappedDisplays(): HostDisplay[] {
  return Array.isArray(window.__SCRY_HOST_DISPLAYS__)
    ? window.__SCRY_HOST_DISPLAYS__
    : [];
}

function isValidDisplay(display: HostDisplay): boolean {
  return (
    Number.isFinite(display.widthMm) &&
    Number.isFinite(display.heightMm) &&
    display.widthMm > 0 &&
    display.heightMm > 0
  );
}

function aspectDistance(display: HostDisplay, screen: Size): number {
  const displayAspect = display.widthMm / display.heightMm;
  const screenAspect = screen.width / screen.height;
  return Math.abs(displayAspect - screenAspect);
}

function nativeResolutionDistance(display: HostDisplay, screen: Size): number {
  if (!display.nativeWidth || !display.nativeHeight)
    return Number.POSITIVE_INFINITY;

  const screenNativeWidth = screen.width * window.devicePixelRatio;
  const screenNativeHeight = screen.height * window.devicePixelRatio;
  const normalDistance =
    Math.abs(display.nativeWidth - screenNativeWidth) +
    Math.abs(display.nativeHeight - screenNativeHeight);
  const rotatedDistance =
    Math.abs(display.nativeWidth - screenNativeHeight) +
    Math.abs(display.nativeHeight - screenNativeWidth);

  return Math.min(normalDistance, rotatedDistance);
}

function chooseDisplay(displays: HostDisplay[], screen: Size): HostDisplay {
  return displays.reduce((best, current) => {
    const currentNativeDistance = nativeResolutionDistance(current, screen);
    const bestNativeDistance = nativeResolutionDistance(best, screen);

    if (currentNativeDistance !== bestNativeDistance) {
      return currentNativeDistance < bestNativeDistance ? current : best;
    }

    return aspectDistance(current, screen) < aspectDistance(best, screen)
      ? current
      : best;
  });
}

function estimateCssPxPerInch(displays: HostDisplay[], screen: Size): number {
  const candidates = displays.filter(isValidDisplay);
  if (candidates.length === 0) return DEFAULT_HOST_CSS_PX_PER_INCH;

  const display = chooseDisplay(candidates, screen);

  const widthInches = display.widthMm / 25.4;
  const heightInches = display.heightMm / 25.4;
  const xCssPxPerInch = screen.width / widthInches;
  const yCssPxPerInch = screen.height / heightInches;
  const estimated = (xCssPxPerInch + yCssPxPerInch) / 2;

  return Number.isFinite(estimated) && estimated > 0
    ? estimated
    : DEFAULT_HOST_CSS_PX_PER_INCH;
}

export function useHostCssPxPerInch(): number {
  const [displays, setDisplays] = useState<HostDisplay[]>(
    getBootstrappedDisplays
  );
  const [screenSize, setScreenSize] = useState<Size>({
    width: window.screen.width,
    height: window.screen.height,
  });

  useEffect(() => {
    let cancelled = false;

    const loadDisplays = async () => {
      try {
        const response = await fetch(HOST_DISPLAY_PATH);
        if (!response.ok) return;
        const payload = (await response.json()) as { displays?: HostDisplay[] };
        const nextDisplays = (payload.displays ?? []).filter(isValidDisplay);
        if (!cancelled && nextDisplays.length > 0) {
          setDisplays(nextDisplays);
        }
      } catch {
        // Keep the CSS standard fallback when host display metadata is missing.
      }
    };

    void loadDisplays();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const updateScreenSize = () => {
      setScreenSize({
        width: window.screen.width,
        height: window.screen.height,
      });
    };

    window.addEventListener('resize', updateScreenSize);
    return () => window.removeEventListener('resize', updateScreenSize);
  }, []);

  return useMemo(
    () => estimateCssPxPerInch(displays, screenSize),
    [displays, screenSize]
  );
}
