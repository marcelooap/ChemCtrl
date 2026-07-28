import { useCallback, useEffect, useRef, useState } from 'react';

const MACAE_LAT = -22.37;
const MACAE_LON = -41.79;
const REFRESH_MS = 30 * 60 * 1000;
const OPEN_METEO_URL =
  `https://api.open-meteo.com/v1/forecast` +
  `?latitude=${MACAE_LAT}&longitude=${MACAE_LON}` +
  `&current=temperature_2m,weather_code,precipitation_probability` +
  `&timezone=America%2FSao_Paulo`;

export interface MacaeWeather {
  temperatureC: number;
  weatherCode: number;
  precipitationProbability: number;
}

interface CacheEntry {
  data: MacaeWeather;
  fetchedAt: number;
}

let memoryCache: CacheEntry | null = null;

export type WeatherIconKind =
  | 'clear'
  | 'mostlyClear'
  | 'partlyCloudy'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'showers'
  | 'snowShowers'
  | 'thunderstorm'
  | 'thunderstormHail'
  | 'unknown';

/** WMO Weather interpretation codes → pt-BR labels */
export function weatherCodeLabel(code: number): string {
  if (code === 0) return 'Céu limpo';
  if (code === 1) return 'Principalmente limpo';
  if (code === 2) return 'Parcialmente nublado';
  if (code === 3) return 'Nublado';
  if (code === 45 || code === 48) return 'Neblina';
  if (code >= 51 && code <= 57) return 'Garoa';
  if (code >= 61 && code <= 67) return 'Chuva';
  if (code >= 71 && code <= 77) return 'Neve';
  if (code >= 80 && code <= 82) return 'Pancadas de chuva';
  if (code >= 85 && code <= 86) return 'Pancadas de neve';
  if (code === 95) return 'Tempestade';
  if (code === 96 || code === 99) return 'Tempestade com granizo';
  return 'Condição variável';
}

/** WMO Weather interpretation codes → icon kind for UI */
export function weatherCodeIconKind(code: number): WeatherIconKind {
  if (code === 0) return 'clear';
  if (code === 1) return 'mostlyClear';
  if (code === 2) return 'partlyCloudy';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code >= 61 && code <= 67) return 'rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'showers';
  if (code >= 85 && code <= 86) return 'snowShowers';
  if (code === 95) return 'thunderstorm';
  if (code === 96 || code === 99) return 'thunderstormHail';
  return 'unknown';
}

async function fetchMacaeWeather(): Promise<MacaeWeather> {
  const res = await fetch(OPEN_METEO_URL);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const json = await res.json();
  const current = json?.current;
  if (
    typeof current?.temperature_2m !== 'number' ||
    typeof current?.weather_code !== 'number'
  ) {
    throw new Error('Open-Meteo: resposta inválida');
  }
  return {
    temperatureC: current.temperature_2m,
    weatherCode: current.weather_code,
    precipitationProbability:
      typeof current.precipitation_probability === 'number'
        ? current.precipitation_probability
        : 0,
  };
}

export function useMacaeWeather() {
  const [weather, setWeather] = useState<MacaeWeather | null>(
    () => memoryCache?.data ?? null
  );
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(!memoryCache);
  const mountedRef = useRef(true);

  const load = useCallback(async (force = false) => {
    const now = Date.now();
    if (
      !force &&
      memoryCache &&
      now - memoryCache.fetchedAt < REFRESH_MS
    ) {
      if (mountedRef.current) {
        setWeather(memoryCache.data);
        setError(false);
        setLoading(false);
      }
      return;
    }

    try {
      const data = await fetchMacaeWeather();
      memoryCache = { data, fetchedAt: Date.now() };
      if (mountedRef.current) {
        setWeather(data);
        setError(false);
        setLoading(false);
      }
    } catch {
      if (mountedRef.current) {
        if (!memoryCache) setWeather(null);
        setError(true);
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();

    const intervalId = window.setInterval(() => void load(true), REFRESH_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      mountedRef.current = false;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load]);

  return { weather, error, loading };
}
