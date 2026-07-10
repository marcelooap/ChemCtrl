import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import {
  SUPPORTED_LANGUAGES,
  LANGUAGE_LABELS,
  LANGUAGE_FLAGS,
  type SupportedLocale,
} from '@/i18n';
import i18n from '@/i18n';

interface LanguageSelectorProps {
  onSelectLocale: (locale: SupportedLocale) => void;
}

export function LanguageSelector({ onSelectLocale }: LanguageSelectorProps) {
  const { t } = useTranslation();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  const currentLocale = (i18n.language || 'pt-BR') as SupportedLocale;

  const handleSelect = (value: string) => {
    const locale = value as SupportedLocale;
    if (locale === currentLocale) return;
    onSelectLocale(locale);
  };

  if (!mounted) {
    return (
      <div className="px-2 py-2">
        <div className="h-9 rounded-md bg-muted animate-pulse" />
      </div>
    );
  }

  return (
    <div className="px-2 py-2">
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="flex items-center justify-between w-full px-2 py-2 text-xs font-medium text-muted-foreground rounded-md hover:bg-accent/50 cursor-pointer">
          <span>{t('language.label')}</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-52">
          <DropdownMenuRadioGroup value={currentLocale} onValueChange={handleSelect}>
            {SUPPORTED_LANGUAGES.map((locale) => (
              <DropdownMenuRadioItem key={locale} value={locale} className="text-xs">
                <span className="mr-2">{LANGUAGE_FLAGS[locale]}</span>
                {LANGUAGE_LABELS[locale]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </div>
  );
}
