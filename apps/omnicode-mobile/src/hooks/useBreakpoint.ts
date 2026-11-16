import { useWindowDimensions } from 'react-native';

export interface Breakpoint {
  width: number;
  isTablet: boolean;
  isDesktop: boolean;
}

export function useBreakpoint(): Breakpoint {
  const { width } = useWindowDimensions();
  return {
    width,
    isTablet: width >= 768,
    isDesktop: width >= 1024,
  };
}
