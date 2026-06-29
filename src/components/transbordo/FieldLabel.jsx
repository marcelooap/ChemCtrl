import React from 'react';

const FieldLabel = ({ children, auto }) => (
  <label className="text-xs font-medium block mb-1" style={{ color: '#333' }}>
    {children} {auto && <span className="text-muted-foreground/60">(auto)</span>}
  </label>
);

export default FieldLabel;
