import { Construction } from "lucide-react";

export default function Placeholder({ title }) {
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Módulo em desenvolvimento</p>
      </div>
      <div className="bg-card rounded-xl border border-border p-16 shadow-sm flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <Construction className="w-8 h-8 text-muted-foreground" />
        </div>
        <p className="text-lg font-semibold text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground mt-1">
          Este módulo será implementado em breve.
        </p>
      </div>
    </div>
  );
}