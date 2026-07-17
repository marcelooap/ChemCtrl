import React from 'react';
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudHail,
  CloudLightning,
  CloudOff,
  CloudRain,
  CloudSnow,
  CloudSun,
  Loader2,
  MapPin,
  Sun,
} from 'lucide-react';
import {
  useMacaeWeather,
  weatherCodeIconKind,
  weatherCodeLabel,
  type WeatherIconKind,
} from '@/hooks/useMacaeWeather';
import { cn } from '@/lib/utils';

const ICON_CLASS = 'w-3.5 h-3.5 shrink-0';

function WeatherConditionIcon({
  kind,
  className,
}: {
  kind: WeatherIconKind;
  className?: string;
}) {
  const props = { className: cn(ICON_CLASS, className), 'aria-hidden': true as const };

  switch (kind) {
    case 'clear':
      return <Sun {...props} className={cn(props.className, 'text-amber-500')} />;
    case 'mostlyClear':
      return <Sun {...props} className={cn(props.className, 'text-amber-400')} />;
    case 'partlyCloudy':
      return <CloudSun {...props} className={cn(props.className, 'text-sky-500')} />;
    case 'cloudy':
      return <Cloud {...props} className={cn(props.className, 'text-slate-400')} />;
    case 'fog':
      return <CloudFog {...props} className={cn(props.className, 'text-slate-400')} />;
    case 'drizzle':
      return <CloudDrizzle {...props} className={cn(props.className, 'text-sky-400')} />;
    case 'rain':
    case 'showers':
      return <CloudRain {...props} className={cn(props.className, 'text-blue-500')} />;
    case 'snow':
    case 'snowShowers':
      return <CloudSnow {...props} className={cn(props.className, 'text-sky-300')} />;
    case 'thunderstorm':
      return <CloudLightning {...props} className={cn(props.className, 'text-violet-500')} />;
    case 'thunderstormHail':
      return <CloudHail {...props} className={cn(props.className, 'text-violet-500')} />;
    default:
      return <Cloud {...props} className={cn(props.className, 'text-muted-foreground')} />;
  }
}

export function TerminalWeatherInfo() {
  const { weather, error, loading } = useMacaeWeather();

  let weatherContent: React.ReactNode;
  if (loading && !weather) {
    weatherContent = (
      <>
        <Loader2 className={cn(ICON_CLASS, 'animate-spin text-muted-foreground')} aria-hidden />
        <span>Carregando clima…</span>
      </>
    );
  } else if (weather) {
    const temp = Math.round(weather.temperatureC);
    const condition = weatherCodeLabel(weather.weatherCode);
    const precip = Math.round(weather.precipitationProbability);
    const iconKind = weatherCodeIconKind(weather.weatherCode);
    weatherContent = (
      <>
        <WeatherConditionIcon kind={iconKind} />
        <span>
          {temp}°C · {condition} · {precip}% precipitação
        </span>
      </>
    );
  } else if (error) {
    weatherContent = (
      <>
        <CloudOff className={cn(ICON_CLASS, 'text-muted-foreground')} aria-hidden />
        <span>Clima indisponível</span>
      </>
    );
  } else {
    weatherContent = <span>—</span>;
  }

  return (
    <div className="hidden sm:block min-w-0 text-left pr-3">
      <p className="flex items-center gap-1.5 text-sm font-medium text-foreground truncate leading-tight">
        <MapPin className="w-3.5 h-3.5 shrink-0 text-[#2575D1]" aria-hidden />
        <span className="truncate">Terminal Imboassica, Macaé – RJ</span>
      </p>
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground truncate leading-tight mt-0.5">
        {weatherContent}
      </p>
    </div>
  );
}
