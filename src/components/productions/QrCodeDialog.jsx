import React, { useState, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Copy, Download, Check, ExternalLink } from 'lucide-react';

export default function QrCodeDialog({ open, onOpenChange, token, lotLabel }) {
  const [copied, setCopied] = useState(false);
  const wrapperRef = useRef(null);

  if (!token) return null;

  const publicUrl = `${window.location.origin}/consulta/${token}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(publicUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleOpen = () => {
    window.open(publicUrl, '_blank');
  };

  const handleDownload = () => {
    const svg = wrapperRef.current?.querySelector('svg');
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = 400;
      canvas.height = 400;
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, 400, 400);
      ctx.drawImage(img, 0, 0, 400, 400);
      URL.revokeObjectURL(url);
      const link = document.createElement('a');
      link.download = `qr-${(lotLabel || token).replace(/[^a-zA-Z0-9-]/g, '')}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    };
    img.src = url;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-center">QR Code de Rastreabilidade</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-2">
          {lotLabel && (
            <p className="text-xs text-muted-foreground text-center font-medium">{lotLabel}</p>
          )}
          <div ref={wrapperRef} className="p-4 bg-white border-2 border-gray-200 rounded-xl">
            <QRCodeSVG value={publicUrl} size={200} level="M" />
          </div>
          <div className="w-full bg-gray-50 rounded-lg p-2.5 text-[10px] font-mono break-all text-gray-500 max-h-16 overflow-y-auto">
            {publicUrl}
          </div>
          <div className="flex gap-2 w-full">
            <Button variant="outline" size="sm" onClick={handleCopy} className="flex-1 gap-1.5 text-xs">
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copiado!' : 'Copiar'}
            </Button>
            <Button variant="outline" size="sm" onClick={handleOpen} className="flex-1 gap-1.5 text-xs">
              <ExternalLink className="w-3 h-3" /> Abrir
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownload} className="flex-1 gap-1.5 text-xs">
              <Download className="w-3 h-3" /> PNG
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
