import React from 'react';
import { useTranslation } from 'react-i18next';

const FieldLabel = ({ children, auto }) => {
  const { t } = useTranslation();
  return (
    <label className="text-xs font-medium block mb-1">
      {children} {auto && <span className="text-muted-foreground/60">({t('transfer.fieldLabel.auto')})</span>}
    </label>
  );
};

export default FieldLabel;
