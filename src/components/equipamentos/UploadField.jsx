import { useState } from 'react';
import { Upload, Loader2, CheckCircle2 } from 'lucide-react';
import { Label } from '@/components/ui/label';
// eslint-disable-next-line
import { uploadFileToSupabase } from '@/api/storage'; // storage module (split from supabaseClient)

const BUCKET = 'equipamentos-lab';

export default function UploadField({ label, value, onChange, accept = '*' }) {
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const path = await uploadFileToSupabase(file, BUCKET);
      onChange(path);
    } catch (err) {
      alert('Erro no upload: ' + err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <div>
      {label && <Label className="text-xs">{label}</Label>}
      <div className="mt-1">
        <label className="flex items-center gap-2 px-3 py-2 rounded-md border border-input cursor-pointer hover:bg-accent text-xs text-gray-600 transition-colors">
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : value ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
            : <Upload className="w-3.5 h-3.5" />}
          <span className="truncate">
            {uploading ? 'Enviando...' : value ? (value.split('/').pop() || 'Enviado') : 'Selecionar arquivo'}
          </span>
          <input type="file" accept={accept} className="hidden" onChange={handleFile} />
        </label>
      </div>
    </div>
  );
}
